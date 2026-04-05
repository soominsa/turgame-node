/**
 * node-client.ts — 중앙서버 통신 클라이언트
 *
 * 노드 등록, heartbeat, 매치 결과 보고
 */

import type { NodeConfig } from './node-config.js';
import {
  API_PATHS,
  type NodeRegistration, type NodeHeartbeat, type NodeRoomInfo,
  type MatchResultReport, type MatchPlayerReport,
  type ApiResponse, type RegisterResponse, type MatchRewardResponse,
} from '@shared/cluster-protocol.js';

export class NodeClient {
  private config: NodeConfig;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private registered = false;
  private startTime = Date.now();

  /** 방/플레이어 수를 외부에서 주입받는 콜백 */
  getRoomStats: () => { activeRooms: number; activePlayers: number; rooms: NodeRoomInfo[] } =
    () => ({ activeRooms: 0, activePlayers: 0, rooms: [] });

  constructor(config: NodeConfig) {
    this.config = config;
  }

  // ─── 등록 ───

  async register(): Promise<boolean> {
    const body: NodeRegistration = {
      apiKey: this.config.apiKey,
      nodeId: this.config.nodeId,
      publicUrl: this.config.publicUrl,
      region: this.config.region,
      maxRooms: this.config.maxRooms,
      operatorWallet: this.config.operatorWallet,
    };

    try {
      const res = await this.post<RegisterResponse>(API_PATHS.NODE_REGISTER, body);
      if (res.ok && res.data) {
        this.config.ticketSecret = res.data.ticketSecret;
        this.registered = true;
        console.log(`[NodeClient] 중앙서버 등록 성공 — ticketSecret=${res.data.ticketSecret.slice(0, 8)}...`);
        this.startHeartbeat();
        return true;
      } else {
        console.error(`[NodeClient] 등록 실패: ${res.error}`);
        return false;
      }
    } catch (e: any) {
      console.error(`[NodeClient] 중앙서버 연결 실패: ${e.message}`);
      return false;
    }
  }

  // ─── Heartbeat ───

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.config.heartbeatInterval);
  }

  private async sendHeartbeat() {
    const stats = this.getRoomStats();
    const body: NodeHeartbeat = {
      nodeId: this.config.nodeId,
      apiKey: this.config.apiKey,
      activeRooms: stats.activeRooms,
      activePlayers: stats.activePlayers,
      cpuLoad: getCpuLoad(),
      uptimeSec: (Date.now() - this.startTime) / 1000,
      rooms: stats.rooms,
    };

    try {
      const res = await this.post(API_PATHS.NODE_HEARTBEAT, body);
      if (!res.ok) {
        console.warn(`[NodeClient] Heartbeat 실패: ${res.error} — 재등록 시도...`);
        this.registered = false;
        await this.register();
      }
    } catch (e: any) {
      console.warn(`[NodeClient] Heartbeat 전송 실패: ${e.message}`);
    }
  }

  // ─── 매치 결과 보고 ───

  async reportMatchResult(report: Omit<MatchResultReport, 'nodeId' | 'apiKey'>): Promise<MatchRewardResponse | null> {
    const body: MatchResultReport = {
      ...report,
      nodeId: this.config.nodeId,
      apiKey: this.config.apiKey,
      operatorWallet: report.operatorWallet ?? this.config.operatorWallet,
    };

    try {
      const res = await this.post<MatchRewardResponse>(API_PATHS.NODE_MATCH_RESULT, body);
      if (res.ok && res.data) {
        console.log(`[NodeClient] 매치 결과 보고 완료: room=${report.roomId}`);
        return res.data;
      } else {
        console.error(`[NodeClient] 매치 결과 보고 실패: ${res.error}`);
        return null;
      }
    } catch (e: any) {
      console.error(`[NodeClient] 매치 결과 전송 실패: ${e.message}`);
      return null;
    }
  }

  // ─── 룬 데이터 조회 (매치 시작 전) ───

  async fetchRuneData(players: Array<{ wallet: string; characterId: string; element?: string; combatRole?: string }>): Promise<Record<string, any> | null> {
    try {
      const res = await this.post<{ data: Record<string, any> }>('/api/rune/rune-data', { players });
      if (res.ok && res.data) return res.data;
      return null;
    } catch (e: any) {
      console.error(`[NodeClient] 룬 데이터 조회 실패: ${e.message}`);
      return null;
    }
  }

  /** 매치 종료 시 글리프 소멸 요청 */
  async consumeGlyphs(wallets: string[]): Promise<void> {
    try {
      await this.post('/api/rune/consume-glyphs', { wallets });
    } catch (e: any) {
      console.error(`[NodeClient] 글리프 소멸 요청 실패: ${e.message}`);
    }
  }

  // ─── 설정 접근 ───

  getTicketSecret(): string {
    return this.config.ticketSecret;
  }

  getConfig(): Readonly<NodeConfig> {
    return this.config;
  }

  isRegistered(): boolean {
    return this.registered;
  }

  // ─── 정리 ───

  destroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── HTTP 유틸 ───

  private async post<T = unknown>(path: string, body: any): Promise<ApiResponse<T>> {
    const url = `${this.config.centralUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json() as ApiResponse<T>;
  }
}

/** 간단한 CPU 부하 추정 (event loop lag 기반) */
function getCpuLoad(): number {
  // 정밀하지 않지만 충분한 추정치
  const start = performance.now();
  // event loop에 부하가 있으면 측정 지연됨
  const lag = performance.now() - start;
  return Math.min(1, lag / 10); // 10ms 이상이면 부하 100%
}
