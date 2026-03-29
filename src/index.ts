/**
 * Elemental Clash 게임노드
 *
 * 역할: 게임 방 실행, 16Hz 틱 루프, AI, 물리 연산
 * 토큰/인증 DB 접근 없음 — 매치 결과만 중앙서버에 보고
 *
 * 실행: npx tsx src/node/index.ts
 *
 * 연결 모드 (자동 선택):
 *   1) UPnP — 공유기에 포트 자동 오픈 → 플레이어 직접 연결 (저지연)
 *   2) 릴레이 — 중앙서버 경유 WS 터널 → NAT 뒤에서도 작동
 *   3) 수동 — NODE_PUBLIC_URL 직접 지정 (포트포워딩 등)
 *
 * 환경변수:
 *   CENTRAL_URL       — 중앙서버 주소 (기본 http://localhost:7300)
 *   NODE_API_KEY      — 중앙서버 인증 키 (필수)
 *   NODE_ID           — 노드 고유 ID (기본 자동 생성)
 *   NODE_PORT         — 게임 서버 포트 (기본 7301)
 *   NODE_PUBLIC_URL   — 외부 접속 주소 (설정 시 UPnP/릴레이 건너뜀)
 *   NODE_REGION       — 리전 (기본 'local')
 *   NODE_MAX_ROOMS    — 최대 방 수 (기본 20)
 *   OPERATOR_WALLET   — 운영자 보상 지갑
 *   NODE_MODE         — 강제 모드: 'upnp' | 'relay' | 'manual' (기본 자동)
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { loadNodeConfig } from './node-config.js';
import { NodeClient } from './node-client.js';
import { NodeRoomManager } from './node-room-manager.js';
// UPnP는 릴레이 모드가 아닐 때만 동적 import (nat-upnp ESM 호환 문제 방지)
let tryUPnPMapping: (port: number) => Promise<any> = async () => null;
let removeUPnPMapping: () => Promise<void> = async () => {};
let refreshUPnPMapping: (port: number) => Promise<boolean> = async () => false;
import { RelayTunnel } from './relay-tunnel.js';

// ─── 설정 로드 ───

const config = loadNodeConfig();
const forceMode = process.env.NODE_MODE as 'upnp' | 'relay' | 'manual' | undefined;

if (!config.apiKey) {
  console.error('❌ NODE_API_KEY 환경변수가 설정되지 않았습니다.');
  console.error('   중앙서버 관리자에게 API 키를 발급받으세요.');
  process.exit(1);
}

// ─── 클라이언트/매니저 생성 ───

const client = new NodeClient(config as any);
const roomManager = new NodeRoomManager(client);
let relayTunnel: RelayTunnel | null = null;
let connectionMode: 'upnp' | 'relay' | 'manual' = 'manual';

// 통계 콜백 연결
client.getRoomStats = () => roomManager.getStats();

// ─── HTTP 서버 ───

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    nodeId: config.nodeId,
    mode: connectionMode,
    rooms: roomManager.getRoomCount(),
    players: roomManager.getPlayerCount(),
    relayedPlayers: relayTunnel?.getRelayedPlayerCount() ?? 0,
    registered: client.isRegistered(),
  }));
});

// ─── WebSocket (직접 연결 — UPnP/수동 모드에서 사용) ───

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  roomManager.handleConnection(ws);
});

// ─── 연결 모드 결정 + 서버 시작 ───

server.listen(config.port, async () => {
  console.log(`🎮 Elemental Clash 게임노드 시작`);
  console.log(`   노드 ID: ${config.nodeId}`);
  console.log(`   로컬 포트: ${config.port}`);
  console.log(`   중앙서버: ${config.centralUrl}`);
  if (config.operatorWallet) {
    console.log(`   운영자 지갑: ${config.operatorWallet}`);
  }

  // ─── 1) 연결 모드 결정 ───

  let publicUrl = config.publicUrl;

  if (forceMode === 'manual' || process.env.NODE_PUBLIC_URL) {
    // 수동 모드: 사용자가 직접 공인 URL 지정
    connectionMode = 'manual';
    console.log(`\n📡 연결 모드: 수동 (NODE_PUBLIC_URL=${publicUrl})`);

  } else if (forceMode !== 'relay') {
    // UPnP 필요 시 동적 import
    let upnpLoaded = false;
    try {
      const upnpMod = await import('./upnp-discovery.js');
      tryUPnPMapping = upnpMod.tryUPnPMapping;
      removeUPnPMapping = upnpMod.removeUPnPMapping;
      refreshUPnPMapping = upnpMod.refreshUPnPMapping;
      upnpLoaded = true;
    } catch (e: any) {
      console.log(`⚠️  UPnP 모듈 로드 실패: ${e.message} — 릴레이 모드로 전환`);
      connectionMode = 'relay';
    }

    if (upnpLoaded) {
      console.log('\n🔍 UPnP 포트 매핑 시도 중...');
      const upnpResult = await tryUPnPMapping(config.port);

      if (upnpResult) {
        connectionMode = 'upnp';
        publicUrl = upnpResult.publicUrl;
        console.log(`✅ UPnP 성공! 공인 주소: ${publicUrl}`);
        console.log(`   → 플레이어가 직접 연결 (저지연)`);
      } else {
        console.log('⚠️  UPnP 실패 — 릴레이 모드로 전환');
        connectionMode = 'relay';
      }
    }
  } else {
    connectionMode = 'relay';
  }

  // ─── 2) 중앙서버 등록 ───

  // 릴레이 모드: publicUrl을 중앙서버의 릴레이 경로로 설정
  if (connectionMode === 'relay') {
    const centralWs = config.centralUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    publicUrl = `${centralWs}/relay/play/${config.nodeId}`;
    console.log(`\n🔄 연결 모드: 릴레이 (중앙서버 경유)`);
    console.log(`   플레이어 접속 URL: ${publicUrl}`);
  }

  // publicUrl을 config에 반영
  (config as any).publicUrl = publicUrl;

  let registered = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    registered = await client.register();
    if (registered) break;
    console.log(`   등록 재시도 ${attempt}/5... (3초 후)`);
    await new Promise(r => setTimeout(r, 3000));
  }

  if (!registered) {
    console.error('❌ 중앙서버 등록 실패 — 독립 모드로 실행 (보상 없음)');
    return;
  }

  // ─── 3) 릴레이 터널 연결 (릴레이 모드일 때만) ───

  if (connectionMode === 'relay') {
    const tunnelUrl = `${config.centralUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}/relay/node/${config.nodeId}`;
    relayTunnel = new RelayTunnel(tunnelUrl, roomManager);

    const tunnelOk = await relayTunnel.connect();
    if (tunnelOk) {
      console.log('✅ 릴레이 터널 연결 완료 — 플레이어 접속 대기 중');
    } else {
      console.error('❌ 릴레이 터널 연결 실패 — 자동 재연결 시도 중...');
    }
  }

  console.log('\n🟢 게임노드 준비 완료!\n');
});

// ─── 종료 ───

async function shutdown() {
  console.log('\n게임노드 종료 중...');

  // UPnP 매핑 해제
  if (connectionMode === 'upnp') {
    await removeUPnPMapping();
  }

  // 릴레이 터널 정리
  if (relayTunnel) {
    relayTunnel.destroy();
  }

  client.destroy();
  wss.close();
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
