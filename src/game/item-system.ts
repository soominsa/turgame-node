/**
 * 아이템 드롭 시스템 — 맵에 주기적으로 소모 아이템 스폰
 */

import type { Entity } from '../shared/combat-entities.js';

// ─── 타입 ───

export type ItemType = 'health_potion' | 'speed_boots' | 'damage_crystal' | 'cooldown_elixir' | 'ult_charge';

export interface ItemDrop {
  id: number;
  type: ItemType;
  x: number;
  y: number;
  spawnTime: number;
  lifetime: number;     // 남은 시간 (30초 후 소멸)
  pickedUp: boolean;
}

export interface Buff {
  type: 'speed' | 'damage';
  remaining: number;
  multiplier: number;
}

// ─── 아이템 정의 ───

export interface ItemInfo {
  name: string;
  icon: string;
  color: string;
  description: string;
  weight: number;       // 드롭 확률 가중치
}

export const ITEM_INFO: Record<ItemType, ItemInfo> = {
  health_potion:   { name: '체력 포션', icon: '🧪', color: '#ff4444', description: 'HP +50 즉시', weight: 30 },
  speed_boots:     { name: '속도 부츠', icon: '👢', color: '#4488ff', description: '15초간 속도 +30%', weight: 20 },
  damage_crystal:  { name: '공격 수정', icon: '💎', color: '#cc44ff', description: '15초간 공격력 +40%', weight: 20 },
  cooldown_elixir: { name: '쿨다운 엘릭서', icon: '⏱️', color: '#44ff88', description: '스킬 쿨 초기화', weight: 15 },
  ult_charge:      { name: '궁극기 충전', icon: '🔥', color: '#ffaa00', description: '궁극기 게이지 +30', weight: 15 },
};

// ─── 스폰 설정 ───

export const ITEM_CONFIG = {
  maxItems: 4,             // 맵에 동시 최대
  spawnInterval: 15,       // 초마다 스폰 시도
  spawnIntervalVariance: 10, // ±10초 랜덤
  itemLifetime: 30,        // 아이템 존재 시간
  pickupRadius: 1.5,       // 획득 거리
  startDelay: 20,          // 게임 시작 후 첫 스폰까지
  buffDuration: 15,        // 속도/공격 버프 지속
  healAmount: 50,
  speedMult: 1.3,
  damageMult: 1.4,
  ultChargeAmount: 30,
};

// ─── 스폰 로직 ───

let nextItemId = 0;

export function resetItemSystem() {
  nextItemId = 0;
}

/** 가중치 기반 랜덤 아이템 타입 선택 */
function rollItemType(): ItemType {
  const types = Object.keys(ITEM_INFO) as ItemType[];
  const totalWeight = types.reduce((s, t) => s + ITEM_INFO[t].weight, 0);
  let roll = Math.random() * totalWeight;
  for (const t of types) {
    roll -= ITEM_INFO[t].weight;
    if (roll <= 0) return t;
  }
  return 'health_potion';
}

/** 스폰 위치 결정 (벽 회피, 맵 중앙부 우선) */
export function pickSpawnPosition(
  fieldW: number, fieldH: number,
  isWallAt: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  // 맵 중앙 60% 영역에서 랜덤
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = fieldW * 0.2 + Math.random() * fieldW * 0.6;
    const y = fieldH * 0.2 + Math.random() * fieldH * 0.6;
    if (!isWallAt(Math.round(x), Math.round(y))) return { x, y };
  }
  return null;
}

/** 아이템 스폰 시도 (틱마다 호출) */
export function trySpawnItem(
  items: ItemDrop[],
  gameTime: number,
  fieldW: number, fieldH: number,
  isWallAt: (x: number, y: number) => boolean,
  nextSpawnAt: number,
): { spawned: ItemDrop | null; nextSpawnAt: number } {
  if (gameTime < ITEM_CONFIG.startDelay) return { spawned: null, nextSpawnAt };
  if (gameTime < nextSpawnAt) return { spawned: null, nextSpawnAt };

  const activeItems = items.filter(i => !i.pickedUp && i.lifetime > 0);
  if (activeItems.length >= ITEM_CONFIG.maxItems) {
    return { spawned: null, nextSpawnAt: gameTime + 5 }; // 5초 후 재시도
  }

  const pos = pickSpawnPosition(fieldW, fieldH, isWallAt);
  if (!pos) return { spawned: null, nextSpawnAt: gameTime + 3 };

  const item: ItemDrop = {
    id: nextItemId++,
    type: rollItemType(),
    x: pos.x, y: pos.y,
    spawnTime: gameTime,
    lifetime: ITEM_CONFIG.itemLifetime,
    pickedUp: false,
  };

  const interval = ITEM_CONFIG.spawnInterval + (Math.random() - 0.5) * 2 * ITEM_CONFIG.spawnIntervalVariance;
  return { spawned: item, nextSpawnAt: gameTime + interval };
}

/** 아이템 획득 체크 */
export function checkPickup(
  items: ItemDrop[],
  entities: Entity[],
): Array<{ entity: Entity; item: ItemDrop }> {
  const pickups: Array<{ entity: Entity; item: ItemDrop }> = [];
  for (const item of items) {
    if (item.pickedUp || item.lifetime <= 0) continue;
    for (const e of entities) {
      if (e.dead) continue;
      const dx = e.x - item.x, dy = e.y - item.y;
      if (dx * dx + dy * dy < ITEM_CONFIG.pickupRadius * ITEM_CONFIG.pickupRadius) {
        item.pickedUp = true;
        pickups.push({ entity: e, item });
        break;
      }
    }
  }
  return pickups;
}

/** 아이템 효과 적용 */
export function applyItem(entity: Entity, item: ItemDrop) {
  switch (item.type) {
    case 'health_potion':
      entity.hp = Math.min(entity.maxHp, entity.hp + ITEM_CONFIG.healAmount);
      break;
    case 'speed_boots':
      entity.buffs = entity.buffs.filter(b => b.type !== 'speed');
      entity.buffs.push({ type: 'speed', remaining: ITEM_CONFIG.buffDuration, multiplier: ITEM_CONFIG.speedMult });
      break;
    case 'damage_crystal':
      entity.buffs = entity.buffs.filter(b => b.type !== 'damage');
      entity.buffs.push({ type: 'damage', remaining: ITEM_CONFIG.buffDuration, multiplier: ITEM_CONFIG.damageMult });
      break;
    case 'cooldown_elixir':
      for (const s of entity.skills) s.remaining = 0;
      break;
    case 'ult_charge':
      entity.ultCharge = Math.min(100, entity.ultCharge + ITEM_CONFIG.ultChargeAmount);
      entity.ultReady = entity.ultCharge >= 100;
      break;
  }
}

/** 버프 틱 업데이트 */
export function updateBuffs(entity: Entity, dt: number) {
  for (const b of entity.buffs) {
    b.remaining -= dt;
  }
  entity.buffs = entity.buffs.filter(b => b.remaining > 0);
}

/** 아이템 수명 업데이트 */
export function updateItems(items: ItemDrop[], dt: number): ItemDrop[] {
  for (const item of items) {
    if (!item.pickedUp) item.lifetime -= dt;
  }
  return items.filter(i => !i.pickedUp && i.lifetime > 0);
}

/** 버프 적용된 속도 배율 */
export function getSpeedMultiplier(entity: Entity): number {
  const speedBuff = entity.buffs.find(b => b.type === 'speed');
  return speedBuff ? speedBuff.multiplier : 1;
}

/** 버프 적용된 공격력 배율 */
export function getDamageMultiplier(entity: Entity): number {
  const dmgBuff = entity.buffs.find(b => b.type === 'damage');
  return dmgBuff ? dmgBuff.multiplier : 1;
}

/** 피해감소 배율 (1.0=기본, 0.7=30%감소) */
export function getDefenseMultiplier(entity: Entity): number {
  const defBuff = entity.buffs.find(b => b.type === 'defense');
  return defBuff ? defBuff.multiplier : 1;
}
