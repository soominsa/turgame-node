/**
 * relay-tunnel.ts — 바이너리 프레이밍 릴레이 터널 (노드측)
 *
 * 중앙서버의 relay.ts와 동일한 바이너리 프로토콜 사용:
 *   [1B 타입][2B ID길이][ID][페이로드]
 *
 * JSON 파싱 없이 버퍼만 조작 → CPU 오버헤드 최소화
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import type { NodeRoomManager } from './node-room-manager.js';

// ─── 프레임 상수 (relay.ts와 동일) ───

const FRAME_PLAYER_CONNECTED     = 0x01;
const FRAME_PLAYER_DISCONNECTED  = 0x02;
const FRAME_FROM_PLAYER          = 0x03;
const FRAME_TO_PLAYER            = 0x04;
const FRAME_DISCONNECT_PLAYER    = 0x05;

function encodeFrame(type: number, playerId: string, payload?: Buffer | string): Buffer {
  const idBuf = Buffer.from(playerId, 'utf8');
  const idLen = idBuf.length;
  const payBuf = payload
    ? (typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload)
    : Buffer.alloc(0);

  const frame = Buffer.allocUnsafe(1 + 2 + idLen + payBuf.length);
  frame[0] = type;
  frame.writeUInt16BE(idLen, 1);
  idBuf.copy(frame, 3);
  payBuf.copy(frame, 3 + idLen);
  return frame;
}

function decodeFrame(buf: Buffer): { type: number; playerId: string; payload: Buffer } | null {
  if (buf.length < 3) return null;
  const type = buf[0];
  const idLen = buf.readUInt16BE(1);
  if (buf.length < 3 + idLen) return null;
  const playerId = buf.toString('utf8', 3, 3 + idLen);
  const payload = buf.subarray(3 + idLen);
  return { type, playerId, payload };
}

// ─── 가상 WebSocket (릴레이된 플레이어를 실제 WS처럼 래핑) ───

export class VirtualWebSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;

  constructor(
    private tunnel: RelayTunnel,
    public readonly playerId: string,
  ) {
    super();
  }

  send(data: string | Buffer) {
    if (this.readyState !== WebSocket.OPEN) return;
    this.tunnel.sendToPlayer(this.playerId, data);
  }

  close(_code?: number, _reason?: string) {
    if (this.readyState === WebSocket.OPEN) {
      this.readyState = WebSocket.CLOSED;
      this.tunnel.disconnectPlayer(this.playerId);
      this.emit('close');
    }
  }

  ping() {}
  terminate() { this.close(); }
}

// ─── 릴레이 터널 ───

export class RelayTunnel {
  private ws: WebSocket | null = null;
  private virtualSockets = new Map<string, VirtualWebSocket>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    private tunnelUrl: string,
    private roomManager: NodeRoomManager,
  ) {}

  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log('[RelayTunnel] 연결 타임아웃');
        resolve(false);
      }, 10_000);

      try {
        this.ws = new WebSocket(this.tunnelUrl);
        this.ws.binaryType = 'nodebuffer';

        this.ws.on('open', () => {
          clearTimeout(timeout);
          console.log(`[RelayTunnel] 바이너리 터널 연결 성공: ${this.tunnelUrl}`);
          resolve(true);
        });

        this.ws.on('message', (raw: Buffer) => {
          const frame = decodeFrame(raw);
          if (!frame) return;
          this.handleFrame(frame);
        });

        this.ws.on('close', () => {
          console.log('[RelayTunnel] 터널 연결 끊김');
          this.handleTunnelClose();
          if (!this.destroyed) this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
          clearTimeout(timeout);
          console.error(`[RelayTunnel] 연결 오류: ${err.message}`);
          resolve(false);
        });
      } catch (e: any) {
        clearTimeout(timeout);
        console.error(`[RelayTunnel] 연결 실패: ${e.message}`);
        resolve(false);
      }
    });
  }

  // ─── 바이너리 프레임 처리 ───

  private handleFrame(frame: { type: number; playerId: string; payload: Buffer }) {
    switch (frame.type) {
      case FRAME_PLAYER_CONNECTED: {
        const vws = new VirtualWebSocket(this, frame.playerId);
        this.virtualSockets.set(frame.playerId, vws);
        this.roomManager.handleConnection(vws as any);
        console.log(`[RelayTunnel] 플레이어 연결: ${frame.playerId}`);
        break;
      }

      case FRAME_FROM_PLAYER: {
        const vws = this.virtualSockets.get(frame.playerId);
        if (vws && vws.readyState === WebSocket.OPEN) {
          // 원본 페이로드를 그대로 message 이벤트로 전달
          vws.emit('message', frame.payload);
        }
        break;
      }

      case FRAME_PLAYER_DISCONNECTED: {
        const vws = this.virtualSockets.get(frame.playerId);
        if (vws) {
          vws.readyState = WebSocket.CLOSED;
          vws.emit('close');
          this.virtualSockets.delete(frame.playerId);
        }
        break;
      }
    }
  }

  // ─── 노드 → 중앙 전송 (바이너리) ───

  sendToPlayer(playerId: string, data: string | Buffer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encodeFrame(FRAME_TO_PLAYER, playerId, data));
    }
  }

  disconnectPlayer(playerId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encodeFrame(FRAME_DISCONNECT_PLAYER, playerId));
    }
    this.virtualSockets.delete(playerId);
  }

  // ─── 터널 끊김 처리 ───

  private handleTunnelClose() {
    for (const [, vws] of this.virtualSockets) {
      vws.readyState = WebSocket.CLOSED;
      vws.emit('close');
    }
    this.virtualSockets.clear();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log('[RelayTunnel] 5초 후 재연결 시도...');
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.destroyed) {
        const ok = await this.connect();
        if (!ok && !this.destroyed) {
          this.scheduleReconnect();
        }
      }
    }, 5_000);
  }

  // ─── 정리 ───

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.handleTunnelClose();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getRelayedPlayerCount(): number {
    return this.virtualSockets.size;
  }
}
