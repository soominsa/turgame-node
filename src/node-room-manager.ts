/**
 * node-room-manager.ts — 게임노드 방 관리
 *
 * 중앙서버에서 발급된 티켓으로 플레이어 인증
 * 게임 로직만 담당, 토큰/인증 DB 접근 없음
 */

import { WebSocket } from 'ws';
import { GameRoom, type RoomPhase } from './server/game-room.js';
import { NodeClient } from './node-client.js';
import { verifyTicket, type JoinTicket, type NodeRoomInfo, type MatchPlayerReport } from '@shared/cluster-protocol.js';
import type { C2S, S2C } from '@shared/protocol.js';

interface NodeConn {
  ws: WebSocket;
  playerId: string;
  roomId: string | null;
  // 티켓에서 추출한 인증 정보
  userId: string;
  wallet: string;
  nickname: string;
  authenticated: boolean;
}

export class NodeRoomManager {
  private rooms = new Map<string, GameRoom>();
  private connections = new Map<WebSocket, NodeConn>();
  private nextId = 1;

  constructor(private client: NodeClient) {}

  handleConnection(ws: WebSocket) {
    const conn: NodeConn = {
      ws,
      playerId: `np${this.nextId++}`,
      roomId: null,
      userId: '',
      wallet: '',
      nickname: '',
      authenticated: false,
    };
    this.connections.set(ws, conn);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(conn, msg);
      } catch { /* 무시 */ }
    });

    ws.on('close', () => {
      this.handleDisconnect(conn);
      this.connections.delete(ws);
    });
  }

  private handleMessage(conn: NodeConn, msg: any) {
    // 첫 메시지는 반드시 티켓 제시
    if (!conn.authenticated) {
      if (msg.type === 'present_ticket') {
        this.handleTicket(conn, msg.ticket);
      } else {
        this.send(conn.ws, { type: 'error', msg: '티켓을 먼저 제시하세요' });
      }
      return;
    }

    // 인증 완료 후: 게임 메시지 처리
    const c2s = msg as C2S;
    switch (c2s.type) {
      case 'pick_char':
      case 'set_team':
      case 'ready':
      case 'start_game':
      case 'input': {
        if (conn.roomId) {
          const room = this.rooms.get(conn.roomId);
          room?.handleMessage(conn.playerId, c2s);
        }
        break;
      }

      // 알 수 없는 메시지는 무시
    }
  }

  // ─── 티켓 인증 ───

  private handleTicket(conn: NodeConn, ticket: JoinTicket) {
    const secret = this.client.getTicketSecret();
    if (!secret) {
      this.send(conn.ws, { type: 'error', msg: '노드 미등록 상태' } as any);
      return;
    }

    if (!verifyTicket(secret, ticket)) {
      this.send(conn.ws, { type: 'error', msg: '티켓 검증 실패 (만료 또는 위조)' } as any);
      conn.ws.close();
      return;
    }

    // 인증 완료
    conn.authenticated = true;
    conn.userId = ticket.userId;
    conn.wallet = ticket.wallet;
    conn.nickname = ticket.nickname;

    // 방에 입장
    const roomId = ticket.roomId;
    let room = this.rooms.get(roomId);

    if (!room) {
      // 새 방 생성 (create_room 요청 → 중앙서버가 이 노드를 선택 → 첫 플레이어가 도착)
      room = this.createRoom(roomId);
      // 매칭 타입 반영 (룬전 분리)
      if (ticket.matchType === 'rune') {
        room.matchMode = 'runed';
      }
    }

    if (room.phase !== 'lobby') {
      this.send(conn.ws, { type: 'error', msg: '이미 게임이 진행 중입니다' } as any);
      return;
    }

    const added = room.addPlayer(conn.ws, conn.playerId, conn.nickname, conn.wallet);
    if (!added) {
      this.send(conn.ws, { type: 'error', msg: '방이 가득 찼습니다' } as any);
      return;
    }

    // NFT 캐릭터 정보 주입
    if (ticket.nftCharIds?.length && conn.wallet) {
      room.nftCharacters.set(conn.wallet, new Set(ticket.nftCharIds));
    }

    conn.roomId = roomId;
    console.log(`[NodeRoom] 플레이어 입장: ${conn.nickname} → room ${roomId}`);
  }

  // ─── 방 생성 ───

  private createRoom(roomId: string): GameRoom {
    const room = new GameRoom(roomId);

    // 매치 종료 콜백 설정
    room.onMatchEnd = (report) => {
      // 중앙서버에 매치 결과 보고
      this.client.reportMatchResult({
        roomId: report.roomId,
        winner: report.winner,
        scoreA: report.scoreA,
        scoreB: report.scoreB,
        durationSec: report.durationSec,
        matchMode: report.matchMode,
        players: report.players,
      });
    };

    // 룬 데이터 fetch 콜백 (룬전 시작 전 중앙서버에서 가져옴)
    room.onFetchRuneData = (players) => this.client.fetchRuneData(players);

    // 글리프 소멸 콜백 (매치 종료 시)
    room.onConsumeGlyphs = (wallets) => this.client.consumeGlyphs(wallets);

    room.onEmpty = () => {
      this.rooms.delete(roomId);
      console.log(`[NodeRoom] 방 삭제: ${roomId} (빈 방)`);
    };

    this.rooms.set(roomId, room);
    console.log(`[NodeRoom] 방 생성: ${roomId}`);
    return room;
  }

  // ─── 연결 해제 ───

  private handleDisconnect(conn: NodeConn) {
    if (conn.roomId) {
      const room = this.rooms.get(conn.roomId);
      room?.removePlayer(conn.playerId);
    }
  }

  // ─── 통계 (heartbeat용) ───

  getStats(): { activeRooms: number; activePlayers: number; rooms: NodeRoomInfo[] } {
    const rooms: NodeRoomInfo[] = [];
    for (const [id, room] of this.rooms) {
      rooms.push({
        roomId: id,
        phase: room.phase,
        playerCount: room.players.length,
        maxPlayers: 8,
        teamA: room.players.filter(p => p.team === 'A').length,
        teamB: room.players.filter(p => p.team === 'B').length,
      });
    }

    return {
      activeRooms: this.rooms.size,
      activePlayers: this.connections.size,
      rooms,
    };
  }

  // ─── 유틸 ───

  private send(ws: WebSocket, msg: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  getRoomCount(): number { return this.rooms.size; }
  getPlayerCount(): number { return this.connections.size; }
}
