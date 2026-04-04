/**
 * cluster-protocol.ts — 중앙서버 ↔ 게임노드 내부 통신 프로토콜
 *
 * 구조:
 *   [플레이어] ──ws──> [중앙서버] ──인증/매칭──> ticket 발급
 *                         │                        │
 *                         │ (REST API)              ▼
 *                         ├──> [게임노드 A] <──ws── [플레이어]
 *                         └──> [게임노드 B] <──ws── [플레이어]
 */

import { createHmac } from 'crypto';

// ─── 노드 등록/상태 ───

export interface NodeRegistration {
  apiKey: string;
  nodeId: string;
  publicUrl: string;       // ws://host:port — 플레이어가 접속할 주소
  region?: string;
  maxRooms: number;
  operatorWallet?: string; // 운영자 보상 지갑
}

export interface NodeHeartbeat {
  nodeId: string;
  apiKey: string;
  activeRooms: number;
  activePlayers: number;
  cpuLoad: number;         // 0~1
  uptimeSec: number;
  rooms: NodeRoomInfo[];   // 방 목록 (매칭용)
}

export interface NodeRoomInfo {
  roomId: string;
  phase: 'lobby' | 'game' | 'ended';
  playerCount: number;
  maxPlayers: number;
  teamA: number;
  teamB: number;
}

export type NodeStatus = 'healthy' | 'unhealthy' | 'dead';

export interface NodeInfo {
  nodeId: string;
  publicUrl: string;
  region: string;
  maxRooms: number;
  operatorWallet: string;
  status: NodeStatus;
  activeRooms: number;
  activePlayers: number;
  cpuLoad: number;
  uptimeSec: number;
  rooms: NodeRoomInfo[];
  lastHeartbeat: number;   // Date.now()
  registeredAt: number;
}

// ─── 매치 결과 리포트 (노드 → 중앙) ───

export interface MatchResultReport {
  nodeId: string;
  apiKey: string;
  roomId: string;
  winner: 'A' | 'B';
  scoreA: number;
  scoreB: number;
  durationSec: number;
  players: MatchPlayerReport[];
  operatorWallet?: string;
}

export interface MatchPlayerReport {
  wallet: string;
  entityId: string;
  entityName: string;
  team: 'A' | 'B';
  role: string;
  kills: number;
  deaths: number;
  assists: number;
  captures: number;
  defends: number;
  damageDealt: number;
  healingDone: number;
  activeTicks: number;
  totalTicks: number;
  isHuman: boolean;
  isNft: boolean;
  element?: string;   // 캐릭터 원소 (Essence 드랍용)
}

// ─── 참가 티켓 (중앙 → 플레이어 → 노드) ───

export interface JoinTicket {
  ticketId: string;
  userId: string;
  wallet: string;
  nickname: string;
  nodeUrl: string;
  roomId: string;
  matchType?: 'normal' | 'rune';  // 매칭 타입 (룬전 분리)
  expiresAt: number;       // Unix ms
  signature: string;       // HMAC-SHA256
}

/** 티켓 생성 (중앙서버에서 호출) */
export function createTicket(
  secret: string,
  data: Omit<JoinTicket, 'signature'>
): JoinTicket {
  const payload = `${data.ticketId}:${data.userId}:${data.wallet}:${data.nickname}:${data.nodeUrl}:${data.roomId}:${data.expiresAt}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return { ...data, signature };
}

/** 티켓 검증 (게임노드에서 호출) */
export function verifyTicket(secret: string, ticket: JoinTicket): boolean {
  if (Date.now() > ticket.expiresAt) return false;
  const payload = `${ticket.ticketId}:${ticket.userId}:${ticket.wallet}:${ticket.nickname}:${ticket.nodeUrl}:${ticket.roomId}:${ticket.expiresAt}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  return expected === ticket.signature;
}

// ─── REST API 응답 타입 ───

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface RegisterResponse {
  nodeId: string;
  ticketSecret: string;   // 티켓 서명용 공유 비밀 (등록 시 1회 전달)
}

export interface CreateRoomResponse {
  roomId: string;
  nodeUrl: string;
  nodeId: string;
}

export interface MatchRewardResponse {
  processed: boolean;
  rewards: { wallet: string; seed: number }[];
  hostReward?: { seed: number };
}

// ─── 중앙서버 WS 메시지 (플레이어 ↔ 중앙) ───

/** 중앙서버 전용 S2C 메시지 */
export type CentralS2C =
  | { type: 'join_ticket'; ticket: JoinTicket; nodeUrl: string }
  | { type: 'room_list'; rooms: RoomListEntry[] }
  | { type: 'node_list'; nodes: { nodeId: string; region: string; playerCount: number; roomCount: number }[] };

export interface RoomListEntry {
  roomId: string;
  nodeUrl: string;
  nodeId: string;
  phase: 'lobby' | 'game' | 'ended';
  playerCount: number;
  maxPlayers: number;
}

// ─── API 경로 상수 ───

export const API_PATHS = {
  NODE_REGISTER:       '/api/node/register',
  NODE_HEARTBEAT:      '/api/node/heartbeat',
  NODE_MATCH_RESULT:   '/api/node/match-result',
  NODE_VALIDATE_TICKET: '/api/node/validate-ticket',
  MATCHMAKING_ROOMS:   '/api/matchmaking/rooms',
  MATCHMAKING_CREATE:  '/api/matchmaking/create',
  MATCHMAKING_JOIN:    '/api/matchmaking/join',
  HEALTH:              '/api/health',
} as const;
