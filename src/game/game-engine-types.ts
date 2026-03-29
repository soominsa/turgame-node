/**
 * 게임 엔진 타입 정의 — 인터페이스, 상수, 설정
 * GameEngine, 렌더러, 서버, 시뮬레이터 모두에서 공통 사용
 */

import { Entity, Skill } from '../shared/combat-entities.js';
import { FieldGrid } from '../core/types.js';
import { TileChangeCallback } from '../core/tick-engine.js';
import type { ItemDrop } from './item-system.js';
import type { MapEvent, EventSchedulerState } from './map-events.js';

/** 스킬 VFX 정보 (콜백에 전달) */
export interface SkillVfxInfo {
  cast?: string;        // 시전 이펙트 시트 ID
  projectile?: string;  // 투사체 이펙트 시트 ID
  hit?: string;         // 적중 이펙트 시트 ID
  scale?: number;       // 스케일 배율 (기본 1.0)
}

// ─── 게임 상태 인터페이스 ───

export interface CapturePoint {
  x: number; y: number;
  radius: number;
  owner: 'A' | 'B' | 'neutral';
  progress: number;
  capturingTeam: 'A' | 'B' | null;
}

export interface Wall {
  x: number; y: number;
  type: 'rock' | 'fence' | 'ruin';
}

export interface Projectile {
  owner: Entity;
  x: number; y: number;
  vx: number; vy: number;
  speed: number;
  damage: number;
  hitRadius: number;
  lifetime: number;
  tracking: 'none' | 'loose';
  target: Entity;
  turnRate: number;
  stunDuration: number;
  aoe: number;
  fieldEffect?: string;
  color: string;
  skillName: string;
  skillVfx?: { cast?: string; projectile?: string; hit?: string; scale?: number };
}

export interface AOETelegraph {
  x: number; y: number;
  radius: number;
  delay: number;
  maxDelay: number;
  damage: number;
  stunDuration: number;
  owner: Entity;
  fieldEffect?: string;
  color: string;
  skillName: string;
  isHeal: boolean;
  skillVfx?: { cast?: string; projectile?: string; hit?: string; scale?: number };
}

// ─── 자원 지형 ───

export type ResourceTerrainType = 'pool' | 'vent' | 'ore' | 'wind' | 'crystal' | 'moss';

export interface ResourceTerrain {
  type: ResourceTerrainType;
  x: number; y: number;
  radius: number;        // 효과 범위 (타일)
  boostRadius: number;   // 스킬 강화 범위
}

export const TERRAIN_INFO: Record<ResourceTerrainType, {
  icon: string; name: string; color: string;
  boostTypes: string[];  // 강화하는 스킬 타입/이름
  damageMult: number;    // 피해/힐 배율 (1.5 = +50%)
}> = {
  pool:    { icon: '💧', name: '연못', color: '#3388CC', boostTypes: ['freeze', 'water', 'heal'], damageMult: 1.5 },
  vent:    { icon: '🌋', name: '열수구', color: '#FF6600', boostTypes: ['ignite', 'damage'], damageMult: 1.5 },
  ore:     { icon: '⛏️', name: '광맥', color: '#A0A0B0', boostTypes: ['cc'], damageMult: 1.5 },
  wind:    { icon: '🌀', name: '바람골', color: '#88CCAA', boostTypes: ['field', 'buff'], damageMult: 1.0 },
  crystal: { icon: '💎', name: '수정', color: '#CC88FF', boostTypes: ['damage'], damageMult: 1.5 },
  moss:    { icon: '🍄', name: '이끼밭', color: '#44AA44', boostTypes: ['heal', 'grow'], damageMult: 1.5 },
};

export interface RainEvent {
  active: boolean;
  remaining: number;     // 남은 지속시간 (초)
  intensity: number;     // 0.3~1.0 (약비~폭우)
  nextRainAt: number;    // 다음 비 시작 시각
  coverLeft: number;     // 비 범위 x 시작 (0~fieldW)
  coverRight: number;    // 비 범위 x 끝
  tickAccum: number;     // 비 틱 누적
}

export interface GameState {
  field: FieldGrid;
  entities: Entity[];
  points: CapturePoint[];
  walls: Wall[];
  scoreA: number;
  scoreB: number;
  time: number;
  tickAccum: number;
  winner: string | null;
  projectiles: Projectile[];
  telegraphs: AOETelegraph[];
  log: string[];
  selectedEntityIdx: number;
  rain: RainEvent;
  terrains: ResourceTerrain[];
  items: ItemDrop[];
  nextItemSpawnAt: number;
  mapEvents: EventSchedulerState;
}

// ─── 게임 설정 ───

export type PathAlgorithm = 'bfs' | 'astar';

export interface GameConfig {
  fieldW: number;
  fieldH: number;
  tickInterval: number;
  burnDps: number;
  respawnTime: number;
  winScore: number;
  invincibleTime: number;
  pathAlgorithm: PathAlgorithm;
  silent: boolean;
  skipTickField: boolean;
  navScale: number;
}

export function defaultConfig(): GameConfig {
  return {
    fieldW: 50,
    fieldH: 26,
    tickInterval: 0.25,
    burnDps: 5,
    respawnTime: 5,
    winScore: 120,
    invincibleTime: 2,
    pathAlgorithm: 'bfs' as PathAlgorithm,
    silent: false,
    skipTickField: false,
    navScale: 0,
  };
}

// ─── 이벤트 콜백 (렌더링 레이어에서 구현) ───

export interface GameCallbacks {
  onLog?: (time: number, msg: string) => void;
  onKill?: (victim: Entity, cause: string, killer?: Entity) => void;
  onDamage?: (target: Entity, amount: number, x: number, y: number) => void;
  onHeal?: (target: Entity, amount: number, x: number, y: number) => void;
  onProjectileHit?: (x: number, y: number, aoe: number, color: string, skillVfx?: SkillVfxInfo) => void;
  onTelegraphDetonate?: (x: number, y: number, radius: number, color: string, isHeal: boolean, skillVfx?: SkillVfxInfo) => void;
  onSkillUse?: (user: Entity, skillName: string, type: string, skillVfx?: SkillVfxInfo) => void;
  onSkillLink?: (user: Entity, targetX: number, targetY: number, skillName: string, type: string, color: string) => void;
  onMeleeHit?: (attacker: Entity, target: Entity, angle: number, skillVfx?: SkillVfxInfo) => void;
  onMeleeMiss?: (attacker: Entity) => void;
  onDash?: (entity: Entity, tx: number, ty: number) => void;
  onDashHit?: (attacker: Entity, target: Entity, damage: number, angle: number) => void;
  onCapture?: (point: CapturePoint, team: string) => void;
  onWin?: (winner: string, scoreA: number, scoreB: number) => void;
  onRespawn?: (entity: Entity) => void;
  onRainStart?: (intensity: number, coverLeft: number, coverRight: number) => void;
  onRainStop?: () => void;
  onTileChange?: TileChangeCallback;
  onCombo?: (name: string, icon: string, cx: number, cy: number, radius: number, isHeal: boolean) => void;
  onItemSpawn?: (item: ItemDrop) => void;
  onItemPickup?: (entity: Entity, item: ItemDrop) => void;
  onMapEventStart?: (event: MapEvent) => void;
  onMapEventActive?: (event: MapEvent) => void;
  onMapEventEnd?: (event: MapEvent) => void;
  onUltimate?: (user: Entity, ultName: string, icon: string, color: string, screenColor: string) => void;
  onUltExecute?: (user: Entity, ultName: string, color: string) => void;
  onUltReady?: (entity: Entity) => void;
}

// ─── AI 컨텍스트 인터페이스 (AI 모듈에서 사용) ───

export interface AIWorldContext {
  entities: Entity[];
  points: CapturePoint[];
  terrains: Array<{ type: string; x: number; y: number; radius: number; boostRadius: number; boostTypes: string[] }>;
  items: Array<{ x: number; y: number; type: string; pickedUp: boolean; lifetime: number }>;
  hazardZones: Array<{ x: number; y: number; radius: number; type: string }>;
  telegraphs: Array<{ x: number; y: number; radius: number; delay: number; owner: Entity; isHeal: boolean }>;
  burningTiles: Array<{ x: number; y: number }>;
  time: number;
  hasLineOfSight: (x1: number, y1: number, x2: number, y2: number) => boolean;
  isWallAt: (x: number, y: number) => boolean;
  findPathBFS: (sx: number, sy: number, tx: number, ty: number) => [number, number][] | null;
  moveToward: (e: Entity, tx: number, ty: number) => void;
  moveAway: (e: Entity, tx: number, ty: number, factor: number) => void;
  autoAttack: (e: Entity, target: Entity) => void;
  autoUseSkills: (e: Entity, target: Entity) => void;
  executeSkill: (user: Entity, skill: Skill, target: Entity) => void;
  findNearestEnemy: (e: Entity) => Entity | null;
  findNearestEnemyIgnoreWalls: (e: Entity) => Entity | null;
  useUltimate: (e: Entity) => void;
}

export type AIRunner = (entity: Entity, ctx: AIWorldContext) => void;

// ─── 유틸리티 (순수 함수) ───

export function angleDiffAbs(a: number, b: number): number {
  let diff = a - b;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff);
}

// ─── 원소 속성 시스템 ───

import type { ElementType } from '../shared/characters/char-sheet.js';
export type { ElementType } from '../shared/characters/char-sheet.js';

/** 상극: 해당 속성이 강한 상대 */
export const ELEMENT_ADVANTAGE: Record<ElementType, ElementType> = {
  fire: 'nature',
  nature: 'earth',
  earth: 'water',
  water: 'fire',
};

/** 상극: 해당 속성의 약점 */
export const ELEMENT_WEAKNESS: Record<ElementType, ElementType> = {
  fire: 'water',
  water: 'earth',
  earth: 'nature',
  nature: 'fire',
};

/** 타일 상태 → 속성 매핑 (null = 중립) */
export function getTileElement(materialType: string | null, thermalState: string | null): ElementType | null {
  if (!thermalState || !materialType) return null;
  switch (thermalState) {
    case 'burning': case 'smoldering': case 'ash': return 'fire';
    case 'frozen': return 'water';
    case 'damp': case 'baked': case 'ceramic': return materialType === 'soil' ? 'earth' : null;
    case 'normal':
      if (materialType === 'water') return 'water';
      if (materialType === 'soil') return 'earth';
      if (materialType === 'wood') return 'nature';
      return null;
    case 'dry':
      if (materialType === 'soil') return 'earth';
      return null;  // dry wood = 버프/디버프 불인정
    default: return null;
  }
}

/** 버프 충전 시간 (초) */
export const ELEMENT_BUFF_CHARGE = 2.0;
/** 버프 지속 시간 (초) */
export const ELEMENT_BUFF_DURATION = 10.0;
/** 디버프 충전 시간 (초) */
export const ELEMENT_DEBUFF_CHARGE = 2.0;
/** 디버프 지속 시간 (초) */
export const ELEMENT_DEBUFF_DURATION = 8.0;

/** 속성별 버프 수치 */
export const ELEMENT_BUFF_VALUES: Record<ElementType, {
  speedMult: number; damageMult: number; defenseMult: number;
  hpRegen: number;   // HP 재생 (최대HP 비율/초, 0=없음)
  ccResist: number;  // CC 지속 감소 비율 (0=없음, 0.25=25% 감소)
}> = {
  fire:   { speedMult: 1.20, damageMult: 1.20, defenseMult: 0.90, hpRegen: 0,    ccResist: 0 },
  water:  { speedMult: 1.08, damageMult: 1.08, defenseMult: 0.92, hpRegen: 0,    ccResist: 0 },
  earth:  { speedMult: 1.10, damageMult: 1.10, defenseMult: 0.82, hpRegen: 0,    ccResist: 0.25 },
  nature: { speedMult: 1.15, damageMult: 1.15, defenseMult: 0.90, hpRegen: 0.02, ccResist: 0 },
};

/** 속성별 디버프 수치 */
export const ELEMENT_DEBUFF_VALUES: Record<ElementType, {
  speedMult: number; damageMult: number; extraDamageMult: number;
}> = {
  fire:   { speedMult: 0.85, damageMult: 0.88, extraDamageMult: 1.15 },  // on water tile
  water:  { speedMult: 0.90, damageMult: 0.90, extraDamageMult: 1.10 },  // on earth tile
  earth:  { speedMult: 0.90, damageMult: 0.92, extraDamageMult: 1.10 },  // on nature tile
  nature: { speedMult: 0.95, damageMult: 0.95, extraDamageMult: 1.08 },  // on fire tile
};

/** 불 타일 DOT (속성별 차등, HP/틱) — fire=면역 */
export const FIRE_DOT_BY_ELEMENT: Record<ElementType, number> = {
  fire: 0,
  earth: 2,
  water: 3,
  nature: 5,
};

export function getFireResist(e: Entity): number {
  switch (e.name) {
    case '테라': return 0.3;
    case '바위': return 0.5;
    case '실반': return -0.3;
    case '그로브': return -0.2;
    case '타이드': return 0.4;
    case '루미나': return 0;
    case '에리스': return 0.2;
    case '페룸': return 0.3;
    default: return 0;
  }
}

export function getIceResist(e: Entity): number {
  switch (e.name) {
    case '테라': return 0.2;
    case '바위': return 0.4;
    case '실반': return 0;
    case '그로브': return 0.3;
    case '타이드': return 0.8;
    case '루미나': return -0.2;
    case '에리스': return 0;
    case '페룸': return -0.3;
    default: return 0;
  }
}
