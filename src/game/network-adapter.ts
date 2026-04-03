/**
 * NetworkAdapter — 싱글/멀티 모드 추상화
 * conquest-scene은 이 인터페이스를 통해 게임 엔진과 소통
 *
 * 중앙서버 통신: REST API (fetch)
 * 게임노드 통신: WebSocket (실시간)
 */

import { S2C, CompactEntity, GameEvent, LobbyPlayer, SerializedCell, MatchRewardEntry } from '../shared/protocol.js';
import { Entity, Skill } from '../shared/combat-entities.js';
import { GameEngine, GameCallbacks, CapturePoint, Wall, Projectile, AOETelegraph, ResourceTerrain, RainEvent } from './game-engine.js';
import { createFieldGrid } from '../core/tick-engine.js';
import { FieldGrid, MaterialType, ThermalState } from '../core/types.js';

// ─── 로비 콜백 ───

export interface LobbyCallbacks {
  onRoomCreated?: (roomId: string, yourId: string) => void;
  onRoomState?: (roomId: string, players: LobbyPlayer[], hostId: string, yourId?: string) => void;
  onError?: (msg: string) => void;
  onGameStart?: () => void;
  onGameOver?: (winner: string, scoreA: number, scoreB: number, rewards?: MatchRewardEntry[]) => void;
}

// ─── REST API 응답 타입 ───

interface AuthResponse {
  ok: boolean;
  userId?: string;
  nickname?: string;
  authType?: string;
  token?: string;
  suiWallet?: string | null;
  error?: string;
}

interface TicketResponse {
  ok: boolean;
  ticket?: any;
  nodeUrl?: string;
  error?: string;
}

interface BalanceResponse {
  ok: boolean;
  water?: number;
  soil?: number;
  wood?: number;
  heat?: number;
  totalMatches?: number;
  error?: string;
}

// ─── 온라인 어댑터 ───

export class OnlineAdapter {
  private nodeWs: WebSocket | null = null;   // 게임노드 WS (릴레이, 게임 메시지)
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  // REST API 기반 상태
  private apiBaseUrl: string = '';
  private authToken: string | null = null;   // Bearer 토큰
  private _connected = false;                // 중앙서버 연결 상태 (REST는 항상 가능)

  // 콜백
  lobbyCallbacks: LobbyCallbacks = {};
  onDisconnect: (() => void) | null = null;
  myPlayerId: string | null = null;
  myEntityId: string | null = null;

  // 게임 상태 (서버 스냅샷 미러)
  field: FieldGrid = [];
  entities: Entity[] = [];
  points: CapturePoint[] = [];
  walls: Wall[] = [];
  terrains: ResourceTerrain[] = [];
  projectiles: Projectile[] = [];
  telegraphs: AOETelegraph[] = [];
  scoreA = 0;
  scoreB = 0;
  time = 0;
  winner: string | null = null;
  rain: RainEvent = {
    active: false, remaining: 0, intensity: 0,
    nextRainAt: 999, coverLeft: 0, coverRight: 50, tickAccum: 0,
  };
  config = { fieldW: 50, fieldH: 26, winScore: 120 };

  // VFX 이벤트 콜백
  private eventCallback: ((ev: GameEvent) => void) | null = null;

  // AFK 콜백
  onIdleWarning: ((remainingSec: number) => void) | null = null;
  onIdleKick: (() => void) | null = null;

  // 보간: 엔티티별 목표 위치 (스냅샷 → lerp)
  private targetPos = new Map<string, { x: number; y: number; vx: number; vy: number }>();

  // 게임 시작 여부
  gameStarted = false;

  /** 중앙서버 연결 (REST 기반 — 연결 성공 콜백 즉시 호출) */
  connect(url: string) {
    // WS URL → HTTP URL 변환
    this.apiBaseUrl = url
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:')
      .replace(/\/ws\/?$/, '');
    this._connected = true;
    this.onConnected?.();
  }

  disconnect() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.nodeWs?.close();
    this.nodeWs = null;
    this._connected = false;
    this.authToken = null;
  }

  isConnected(): boolean { return this._connected; }

  /** 중앙서버 재연결 (REST 기반 — 항상 사용 가능) */
  reconnectCentral() {
    if (this._connected) return;
    this._connected = true;
    this.onConnected?.();
  }

  // ─── 인증 (REST API) ───

  async guestLogin(guestId?: string) {
    const res = await this.post<AuthResponse>('/api/player/guest', { guestId });
    if (res.ok && res.userId && res.token) {
      this.authToken = res.token;
      this.onAuth?.(res.userId, res.nickname!, res.authType!, res.token, res.suiWallet ?? null);
    } else {
      this.onAuthError?.(res.error ?? '게스트 로그인 실패');
    }
  }

  async register(nickname: string, password: string) {
    const res = await this.post<AuthResponse>('/api/player/register', { nickname, password });
    if (res.ok && res.userId && res.token) {
      this.authToken = res.token;
      this.onAuth?.(res.userId, res.nickname!, res.authType!, res.token, res.suiWallet ?? null);
    } else {
      this.onAuthError?.(res.error ?? '회원가입 실패');
    }
  }

  async login(nickname: string, password: string) {
    const res = await this.post<AuthResponse>('/api/player/login', { nickname, password });
    if (res.ok && res.userId && res.token) {
      this.authToken = res.token;
      this.onAuth?.(res.userId, res.nickname!, res.authType!, res.token, res.suiWallet ?? null);
    } else {
      this.onAuthError?.(res.error ?? '로그인 실패');
    }
  }

  async upgradeAccount(nickname: string, password: string) {
    const res = await this.post<AuthResponse>('/api/player/upgrade', { nickname, password });
    if (res.ok && res.userId && res.token) {
      this.authToken = res.token;
      this.onAuth?.(res.userId, res.nickname!, res.authType!, res.token, res.suiWallet ?? null);
    } else {
      this.onAuthError?.(res.error ?? '업그레이드 실패');
    }
  }

  async linkWallet(suiWallet: string) {
    const res = await this.post<AuthResponse>('/api/player/wallet', { suiWallet });
    if (res.ok && res.userId && res.token) {
      this.authToken = res.token;
      this.onAuth?.(res.userId, res.nickname!, res.authType!, res.token, res.suiWallet ?? null);
    } else {
      this.onAuthError?.(res.error ?? '지갑 연결 실패');
    }
  }

  async getBalance() {
    const res = await this.get<BalanceResponse>('/api/player/balance');
    if (res.ok) {
      this.onBalance?.(res.water!, res.soil!, res.wood!, res.heat!, res.totalMatches!);
    }
  }

  // 연결 콜백
  onConnected?: () => void;

  // 인증 콜백
  onAuth?: (userId: string, nickname: string, authType: string, token: string, suiWallet: string | null) => void;
  onAuthError?: (error: string) => void;
  onBalance?: (water: number, soil: number, wood: number, heat: number, totalMatches: number) => void;

  // ─── 로비 명령 (REST → 게임노드 WS 연결) ───

  async createRoom(playerName: string) {
    const res = await this.post<TicketResponse>('/api/player/rooms/create', { playerName });
    if (res.ok && res.ticket && res.nodeUrl) {
      this.connectToNode(res.ticket, res.nodeUrl);
    } else {
      this.lobbyCallbacks.onError?.(res.error ?? '방 생성 실패');
    }
  }

  async joinRoom(roomId: string, playerName: string) {
    const res = await this.post<TicketResponse>('/api/player/rooms/join', { roomId, playerName });
    if (res.ok && res.ticket && res.nodeUrl) {
      this.connectToNode(res.ticket, res.nodeUrl);
    } else {
      this.lobbyCallbacks.onError?.(res.error ?? '방 참가 실패');
    }
  }

  pickChar(charIndex: number) {
    this.sendToNode({ type: 'pick_char', charIndex });
  }

  setTeam(team: 'A' | 'B') {
    this.sendToNode({ type: 'set_team', team });
  }

  toggleReady() {
    this.sendToNode({ type: 'ready' });
  }

  startGame() {
    this.sendToNode({ type: 'start_game' });
  }

  // ─── 게임 입력 ───

  sendInput(mx: number, my: number, skills: number[], attack: boolean) {
    this.sendToNode({ type: 'input', mx, my, skills, attack });
  }

  /** 글리프 발동 메시지 전송 (룬전) */
  activateGlyph(slotIndex: number, targetHex?: { col: number; row: number }) {
    this.sendToNode({ type: 'activate_glyph', slotIndex, targetHex });
  }

  onEvent(callback: (ev: GameEvent) => void) {
    this.eventCallback = callback;
  }

  // ─── 게임노드 WS 메시지 처리 ───

  private handleNodeMessage(msg: S2C) {
    switch (msg.type) {
      case 'room_created':
        this.lobbyCallbacks.onRoomCreated?.(msg.roomId, msg.yourId);
        break;

      case 'room_state':
        this.lobbyCallbacks.onRoomState?.(msg.roomId, msg.players, msg.hostId, msg.yourId);
        break;

      case 'error':
        this.lobbyCallbacks.onError?.(msg.msg);
        break;

      case 'game_start':
        this.myEntityId = msg.yourEntityId;
        this.config = msg.config;
        this.field = this.deserializeField(msg.field, msg.config.fieldW, msg.config.fieldH);
        this.walls = msg.walls.map(w => ({ x: w.x, y: w.y, type: w.type as Wall['type'] }));
        this.points = msg.points.map(p => ({ ...p }));
        this.terrains = msg.terrains.map(t => ({
          type: t.type as ResourceTerrain['type'],
          x: t.x, y: t.y, radius: t.radius, boostRadius: t.boostRadius,
        }));
        this.entities = msg.entities.map(e => this.compactToEntity(e));
        this.scoreA = 0;
        this.scoreB = 0;
        this.time = 0;
        this.winner = null;
        this.projectiles = [];
        this.telegraphs = [];
        this.gameStarted = true;
        this.lobbyCallbacks.onGameStart?.();
        break;

      case 'snap':
        this.applySnapshot(msg);
        break;

      case 'tiles':
        this.applyTileChanges(msg.changes);
        break;

      case 'events':
        for (const ev of msg.list) {
          this.eventCallback?.(ev);
        }
        break;

      case 'game_over':
        this.winner = msg.winner;
        this.lobbyCallbacks.onGameOver?.(msg.winner, msg.scoreA, msg.scoreB, msg.rewards);
        break;

      case 'idle_warning':
        this.onIdleWarning?.(msg.remainingSec);
        break;

      case 'idle_kick':
        this.onIdleKick?.();
        break;
    }
  }

  // ─── 스냅샷 적용 ───

  private applySnapshot(snap: Extract<S2C, { type: 'snap' }>) {
    this.time = snap.t;
    this.scoreA = snap.sA;
    this.scoreB = snap.sB;
    this.winner = snap.winner;

    // 엔티티 업데이트
    for (const ce of snap.e) {
      const existing = this.entities.find(e => e.id === ce.id);
      if (existing) {
        this.applyCompactToEntity(existing, ce);
      }
    }

    // 투사체
    this.projectiles = snap.p.map(p => ({
      owner: this.entities[0], // placeholder
      x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      speed: 0, damage: 0, hitRadius: 0, lifetime: 1,
      tracking: 'none' as const, target: this.entities[0],
      turnRate: 0, stunDuration: 0, aoe: p.aoe,
      fieldEffect: undefined, color: p.color, skillName: p.skillName,
    }));

    // 텔레그래프
    this.telegraphs = snap.tg.map(t => ({
      x: t.x, y: t.y, radius: t.radius,
      delay: t.delay, maxDelay: t.maxDelay,
      damage: 0, stunDuration: 0,
      owner: this.entities[0],
      fieldEffect: undefined, color: t.color,
      skillName: t.skillName, isHeal: t.isHeal,
    }));

    // 거점
    for (let i = 0; i < snap.cp.length && i < this.points.length; i++) {
      Object.assign(this.points[i], snap.cp[i]);
    }

    // 비
    if (snap.rain) {
      this.rain.active = snap.rain.active;
      this.rain.intensity = snap.rain.intensity;
      this.rain.coverLeft = snap.rain.coverLeft;
      this.rain.coverRight = snap.rain.coverRight;
    } else {
      this.rain.active = false;
    }
  }

  // ─── 타일 변경 적용 ───

  private applyTileChanges(changes: Array<{ x: number; y: number; mat: string }>) {
    for (const ch of changes) {
      if (!this.field[ch.y]?.[ch.x]) continue;
      if (ch.mat === 'null') {
        this.field[ch.y][ch.x].material = null;
      } else {
        try {
          const parsed = JSON.parse(ch.mat);
          this.field[ch.y][ch.x].material = {
            type: parsed.t as MaterialType,
            thermalState: parsed.ts as ThermalState,
            temperature: parsed.tp,
            mass: parsed.m,
            structure: 100, combustibility: 0,
            ignitionTemp: 500, heatCapacity: 1, conductivity: 0.1,
          };
        } catch { /* ignore */ }
      }
    }
  }

  // ─── 역직렬화 ───

  private deserializeField(data: (SerializedCell | null)[][], w: number, h: number): FieldGrid {
    const field = createFieldGrid(w, h);
    for (let y = 0; y < h && y < data.length; y++) {
      for (let x = 0; x < w && x < data[y].length; x++) {
        const cell = data[y][x];
        if (cell) {
          field[y][x].material = {
            type: cell.t as MaterialType,
            thermalState: cell.ts as ThermalState,
            temperature: cell.tp,
            mass: cell.m,
            structure: 100, combustibility: 0,
            ignitionTemp: 500, heatCapacity: 1, conductivity: 0.1,
          };
        }
      }
    }
    return field;
  }

  private compactToEntity(ce: CompactEntity): Entity {
    return {
      id: ce.id, name: ce.name, team: ce.team, role: ce.role,
      element: (ce as any).element ?? 'fire',
      x: ce.x, y: ce.y, vx: ce.vx, vy: ce.vy,
      speed: ce.speed, hp: ce.hp, maxHp: ce.maxHp,
      attackDamage: ce.attackDamage, attackSpeed: 1,
      attackRange: ce.attackRange, attackCooldown: 0,
      visionRange: (ce as any).visionRange ?? 6,
      skills: ce.skills.map((s, i) => ({
        name: s.name, cooldown: s.cooldown,
        remaining: ce.sr[i] ?? s.remaining,
        damage: s.damage, range: s.range,
        stunDuration: 0, aoe: 0,
        type: s.type as Skill['type'],
      })),
      passives: [],
      color: ce.color, size: ce.size,
      stunTimer: ce.st, burnTimer: ce.bt,
      facingAngle: ce.fa,
      dashing: ce.ds, dashTarget: null,
      dashSpeed: 0, dashDamage: 0, dashStun: 0, dashSkillName: '',
      dead: ce.dead, respawnTimer: ce.rt,
      spawnX: ce.x, spawnY: ce.y,
      invincibleTimer: ce.it,
      kills: ce.k, deaths: ce.d, assists: 0, captures: 0, defends: 0,
      damageDealt: ce.dd, healingDone: ce.hd, damageTaken: 0,
      ultCharge: 0, ultReady: false, ultCasting: 0,
      skillCasting: 0, skillRecovery: 0, pendingSkill: null,
      buffs: [],
      elemBuff: 0, elemDebuff: 0, elemChargeTimer: 0, elemChargeType: null,
    };
  }

  private applyCompactToEntity(e: Entity, ce: CompactEntity) {
    // 위치는 보간 대상으로 저장 (즉시 적용하지 않음)
    this.targetPos.set(e.id, { x: ce.x, y: ce.y, vx: ce.vx, vy: ce.vy });
    // 죽은 엔티티나 리스폰은 즉시 적용
    if (ce.dead || e.dead !== ce.dead) {
      e.x = ce.x; e.y = ce.y;
    }
    e.vx = ce.vx; e.vy = ce.vy;
    e.hp = ce.hp; e.maxHp = ce.maxHp;
    e.facingAngle = ce.fa;
    e.dead = ce.dead;
    e.respawnTimer = ce.rt;
    e.invincibleTimer = ce.it;
    e.stunTimer = ce.st;
    e.burnTimer = ce.bt;
    e.dashing = ce.ds;
    e.kills = ce.k; e.deaths = ce.d;
    e.damageDealt = ce.dd; e.healingDone = ce.hd;
    // 불변 필드는 lightEntity에서 빈값이므로 무시
    if (ce.speed > 0) e.speed = ce.speed;
    if (ce.attackDamage > 0) e.attackDamage = ce.attackDamage;
    // 스킬 쿨타임 업데이트
    for (let i = 0; i < e.skills.length && i < ce.sr.length; i++) {
      e.skills[i].remaining = ce.sr[i];
    }
  }

  /** 매 프레임 호출: 엔티티+투사체 보간 */
  interpolate(dt: number, myEntityId: string | null) {
    // 엔티티 보간
    const lerpSpeed = 20; // 빠른 따라잡기
    for (const e of this.entities) {
      if (e.id === myEntityId) continue;
      const target = this.targetPos.get(e.id);
      if (!target || e.dead) continue;
      const t = Math.min(1, lerpSpeed * dt);
      e.x += (target.x - e.x) * t;
      e.y += (target.y - e.y) * t;
    }
    // 투사체: 속도 기반 예측 이동
    for (const p of this.projectiles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  // ─── 노드 릴레이 연결 (클러스터 모드) ───

  private connectToNode(ticket: any, nodeUrl: string) {
    // nodeUrl이 ws://central:7300/relay/play/... 형태일 수 있으므로
    // 현재 페이지 호스트 기반으로 변환
    let wsUrl = nodeUrl;
    try {
      const parsed = new URL(nodeUrl);
      const loc = window.location;
      // 내부 호스트(central, localhost 등)를 현재 접속 호스트로 치환
      if (parsed.hostname === 'central' || parsed.hostname === '127.0.0.1' ||
          (parsed.hostname === 'localhost' && parsed.port !== loc.port)) {
        const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsProto}//${loc.host}${parsed.pathname}${parsed.search}`;
      }
    } catch { /* URL 파싱 실패 시 원본 사용 */ }

    console.log(`[OnlineAdapter] 노드 연결: ${wsUrl}`);

    this.nodeWs = new WebSocket(wsUrl);

    this.nodeWs.onopen = () => {
      // 티켓 제시
      this.nodeWs!.send(JSON.stringify({ type: 'present_ticket', ticket }));
      console.log('[OnlineAdapter] 노드 연결 완료, 티켓 제시');
      // 킵얼라이브 ping (30초 간격) — 프록시/LB 타임아웃 방지
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.nodeWs && this.nodeWs.readyState === WebSocket.OPEN) {
          this.nodeWs.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30_000);
    };

    this.nodeWs.onmessage = async (event) => {
      try {
        // 릴레이 경유 시 Blob으로 올 수 있음
        let text: string;
        if (event.data instanceof Blob) {
          text = await event.data.text();
        } else if (event.data instanceof ArrayBuffer) {
          text = new TextDecoder().decode(event.data);
        } else {
          text = event.data as string;
        }
        const msg: S2C = JSON.parse(text);
        this.handleNodeMessage(msg);
      } catch { /* 무시 */ }
    };

    this.nodeWs.onclose = () => {
      console.log('[OnlineAdapter] 노드 연결 끊김');
      this.nodeWs = null;
      // 노드 연결은 게임 진행의 핵심 — 끊기면 disconnect 처리
      this.onDisconnect?.();
    };

    this.nodeWs.onerror = (err) => {
      console.error('[OnlineAdapter] 노드 연결 에러:', err);
      this.lobbyCallbacks.onError?.('게임 노드 연결 실패');
    };
  }

  // ─── REST API 유틸 ───

  private async post<T>(path: string, body: any): Promise<T> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

      const resp = await fetch(`${this.apiBaseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      return await resp.json() as T;
    } catch (e: any) {
      return { ok: false, error: '서버 연결 실패' } as T;
    }
  }

  private async get<T>(path: string): Promise<T> {
    try {
      const headers: Record<string, string> = {};
      if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

      const resp = await fetch(`${this.apiBaseUrl}${path}`, { headers });
      return await resp.json() as T;
    } catch (e: any) {
      return { ok: false, error: '서버 연결 실패' } as T;
    }
  }

  /** 중앙서버 REST API 호출 (외부 노출) */
  async postApi<T>(path: string, body: any): Promise<T> {
    return this.post<T>(path, body);
  }

  /** 게임노드로 메시지 전송 (게임 조작) */
  private sendToNode(msg: any) {
    if (this.nodeWs && this.nodeWs.readyState === WebSocket.OPEN) {
      this.nodeWs.send(JSON.stringify(msg));
    }
  }
}
