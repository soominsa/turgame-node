/**
 * node-config.ts — 게임노드 설정 (환경변수 기반)
 *
 * 환경변수:
 *   CENTRAL_URL       — 중앙서버 주소 (기본 http://localhost:7300)
 *   NODE_API_KEY      — 중앙서버 인증 키
 *   NODE_ID           — 노드 고유 ID (기본 자동 생성)
 *   NODE_PORT         — 게임 서버 포트 (기본 7301)
 *   NODE_PUBLIC_URL   — 외부 접속 주소 (기본 ws://localhost:{NODE_PORT})
 *   NODE_REGION       — 리전 (기본 'local')
 *   NODE_MAX_ROOMS    — 최대 방 수 (기본 20)
 *   OPERATOR_WALLET   — 운영자 보상 지갑
 */

import { randomUUID } from 'crypto';

export interface NodeConfig {
  centralUrl: string;
  apiKey: string;
  nodeId: string;
  port: number;
  publicUrl: string;
  region: string;
  maxRooms: number;
  operatorWallet: string;
  ticketSecret: string;     // 중앙서버에서 등록 시 수신
  heartbeatInterval: number; // ms
}

export function loadNodeConfig(): Omit<NodeConfig, 'ticketSecret'> & { ticketSecret: string } {
  const port = Number(process.env.NODE_PORT) || 7301;
  return {
    centralUrl: process.env.CENTRAL_URL ?? 'http://localhost:7300',
    apiKey: process.env.NODE_API_KEY ?? '',
    nodeId: process.env.NODE_ID ?? `node-${randomUUID().slice(0, 8)}`,
    port,
    publicUrl: process.env.NODE_PUBLIC_URL ?? `ws://localhost:${port}`,
    region: process.env.NODE_REGION ?? 'local',
    maxRooms: Number(process.env.NODE_MAX_ROOMS) || 20,
    operatorWallet: process.env.OPERATOR_WALLET ?? '',
    ticketSecret: '', // 등록 후 중앙서버에서 수신
    heartbeatInterval: 15_000, // 15초
  };
}
