/**
 * 멀티플레이어 네트워크 프로토콜 — 클라이언트/서버 공유 타입
 */

// ─── 로비 타입 ───

export interface LobbyPlayer {
  id: string;
  name: string;
  team: 'A' | 'B';
  charIndex: number;   // 0-7 (ALL_CHARS 인덱스), -1 = 미선택
  ready: boolean;
}

// ─── 클라이언트 → 서버 ───

export type C2S =
  // 게임노드 접속 (클러스터 모드)
  | { type: 'present_ticket'; ticket: any }
  // 게임 조작
  | { type: 'pick_char'; charIndex: number }
  | { type: 'set_team'; team: 'A' | 'B' }
  | { type: 'ready' }
  | { type: 'start_game' }         // 호스트만
  | { type: 'input'; mx: number; my: number; skills: number[]; attack: boolean }
  // 킵얼라이브
  | { type: 'ping' };

// ─── 서버 → 클라이언트 ───

export interface CompactEntity {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  hp: number; maxHp: number;
  fa: number;          // facingAngle
  dead: boolean;
  rt: number;          // respawnTimer
  it: number;          // invincibleTimer
  st: number;          // stunTimer
  bt: number;          // burnTimer
  ds: boolean;         // dashing
  sr: number[];        // skill remaining cooldowns
  k: number;           // kills
  d: number;           // deaths
  dd: number;          // damageDealt
  hd: number;          // healingDone
  name: string;
  team: 'A' | 'B';
  role: 'ranged' | 'melee' | 'tank' | 'support';
  color: string;
  size: number;
  speed: number;
  attackDamage: number;
  attackRange: number;
  skills: CompactSkill[];
}

export interface CompactSkill {
  name: string;
  cooldown: number;
  remaining: number;
  damage: number;
  range: number;
  type: string;
}

export interface CompactProjectile {
  x: number; y: number;
  vx: number; vy: number;
  color: string;
  aoe: number;
  skillName: string;
}

export interface CompactTelegraph {
  x: number; y: number;
  radius: number;
  delay: number;
  maxDelay: number;
  color: string;
  isHeal: boolean;
  skillName: string;
}

export interface CompactPoint {
  x: number; y: number;
  radius: number;
  owner: 'A' | 'B' | 'neutral';
  progress: number;
  capturingTeam: 'A' | 'B' | null;
}

export interface CompactRain {
  active: boolean;
  intensity: number;
  coverLeft: number;
  coverRight: number;
}

// 타일 변경 (필드 델타 싱크)
export interface TileChange {
  x: number; y: number;
  mat: string;           // material JSON 또는 'null'
}

// 게임 이벤트 (VFX용)
export type GameEvent =
  | { ev: 'kill'; victimId: string; cause: string; killerId?: string }
  | { ev: 'damage'; targetId: string; amount: number; x: number; y: number }
  | { ev: 'heal'; targetId: string; amount: number; x: number; y: number }
  | { ev: 'projectile_hit'; x: number; y: number; aoe: number; color: string }
  | { ev: 'telegraph_det'; x: number; y: number; radius: number; color: string; isHeal: boolean }
  | { ev: 'skill_use'; userId: string; skillName: string; skillType: string }
  | { ev: 'melee_hit'; attackerId: string; targetId: string; angle: number }
  | { ev: 'melee_miss'; attackerId: string }
  | { ev: 'dash'; entityId: string; tx: number; ty: number }
  | { ev: 'dash_hit'; attackerId: string; targetId: string; damage: number; angle: number }
  | { ev: 'capture'; x: number; y: number; team: string }
  | { ev: 'rain_start'; intensity: number; coverLeft: number; coverRight: number }
  | { ev: 'rain_stop' }
  | { ev: 'respawn'; entityId: string };

// 직렬화된 필드 셀
export interface SerializedCell {
  t: string;     // material type ('wood','water','soil','metal','ash','fire','steam','mud')
  ts: string;    // thermal state
  tp: number;    // temperature
  m: number;     // mass
} // null이면 빈 셀

// S2C 메시지 타입
export type S2C =
  | { type: 'room_created'; roomId: string; yourId: string }
  | { type: 'room_state'; roomId: string; players: LobbyPlayer[]; hostId: string; yourId?: string }
  | { type: 'error'; msg: string }
  | {
      type: 'game_start';
      yourEntityId: string;
      field: (SerializedCell | null)[][];
      walls: Array<{ x: number; y: number; type: string }>;
      points: CompactPoint[];
      terrains: Array<{ type: string; x: number; y: number; radius: number; boostRadius: number }>;
      entities: CompactEntity[];
      config: { fieldW: number; fieldH: number; winScore: number };
    }
  | {
      type: 'snap';
      t: number;
      e: CompactEntity[];
      p: CompactProjectile[];
      tg: CompactTelegraph[];
      cp: CompactPoint[];
      sA: number;
      sB: number;
      rain: CompactRain | null;
      winner: string | null;
    }
  | { type: 'tiles'; changes: TileChange[] }
  | { type: 'events'; list: GameEvent[] }
  | { type: 'game_over'; winner: string; scoreA: number; scoreB: number; rewards?: MatchRewardEntry[] }
  // AFK 타임아웃
  | { type: 'idle_warning'; remainingSec: number }
  | { type: 'idle_kick' };

export interface MatchRewardEntry {
  entityId: string;
  name: string;
  team: 'A' | 'B';
  role: string;
  contribution: number;
  water: number;
  soil: number;
  heat: number;
  blocked: boolean;
  aiDelegationRatio?: number;  // AI 위임 비율 (0~1)
  aiMultiplier?: number;       // AI 위임 보상 배율 (1.0 = 풀, 0.1 = 최소)
}

// ─── 유틸리티 ───

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
