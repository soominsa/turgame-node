/**
 * 원소 연계(Synergy) 시스템 — element-synergy-design.md 1~2장 구현
 *
 * applyFieldEffect() 호출 시 기존 타일 + 투입 원소로 연계 반응 판정.
 * 13종 연계: 수증기장막, 화염토네이도, 산불, 빙판, 감전확산, 열충격,
 *           용암, 급성장벽, 수렁, 블리자드, 뿌리지진, 전기불꽃, 꽃가루폭풍
 */

import type { Entity } from '../shared/combat-entities.js';
import type { FieldGrid, Material } from '../core/types.js';
import type { FieldEffectType } from '../shared/characters/char-sheet.js';

// ─── 타입 ───

export interface ComboResult {
  name: string;
  icon: string;
  damage: number;           // 즉시 데미지 (음수=힐)
  radius: number;           // 효과 범위
  stunDuration: number;     // 스턴
  cx: number; cy: number;   // 중심
  // 연계 고유 효과
  fieldCreate?: FieldEffectType;   // 생성할 필드 타입
  fieldCreateDuration?: number;    // 필드 지속시간
  root?: number;                   // 속박 지속
  slow?: { ratio: number; duration: number };
  burn?: number;                   // 화상 지속
  shock?: number;                  // 감전 지속
  blind?: number;                  // 시야차단 지속
  freeze?: number;                 // 빙결 지속
  spreadFire?: boolean;            // ③산불: 인접 grow 연쇄 점화
  electrocute?: boolean;           // ⑤감전확산: 물 전체 전기 전파
  sparkIgnite?: boolean;           // ⑫전기불꽃: 주변 grow 자동 점화
  tornado?: { angle: number; speed: number; duration: number };  // ②화염토네이도
  blizzard?: { angle: number; range: number };  // ⑩블리자드
  pollenSneeze?: boolean;          // ⑬꽃가루
  createWall?: { hp: number; duration: number };  // ⑧급성장벽
  swampSink?: boolean;             // ⑨수렁
}

// 쿨다운 캐시
const comboCooldowns = new Map<string, number>();
const COMBO_COOLDOWN = 3;

export function resetComboCooldowns() {
  comboCooldowns.clear();
}

// ─── 타일 상태 판별 헬퍼 ───

function isIgnite(m: Material | null): boolean {
  return m !== null && (m.thermalState === 'burning' || m.thermalState === 'molten' || m.temperature > 200);
}

function isFreeze(m: Material | null): boolean {
  return m !== null && m.thermalState === 'frozen';
}

function isWater(m: Material | null): boolean {
  return m !== null && m.type === 'water' && m.thermalState !== 'frozen';
}

function isGrow(m: Material | null): boolean {
  return m !== null && m.type === 'wood' && m.thermalState === 'normal';
}

function isMud(m: Material | null): boolean {
  return m !== null && m.type === 'soil' && m.thermalState === 'damp';
}

// ─── 필드이펙트 → 원소 매핑 ───

function effectToElement(effect: string): string {
  switch (effect) {
    case 'ignite': return 'fire';
    case 'freeze': return 'water';  // freeze 스킬은 물 원소
    case 'water': return 'water';
    case 'grow': return 'nature';
    case 'mud': return 'earth';
    case 'electric': return 'electric';
    default: return effect;
  }
}

// ─── 연계 테이블 (설계서 13종) ───

interface SynergyEntry {
  name: string;
  icon: string;
  /** 기존 타일 상태 판별 */
  existingMatch: (m: Material | null) => boolean;
  /** 투입하는 필드이펙트 또는 원소 */
  newEffects: string[];
  /** 캐릭터 원소로도 트리거 가능 (wind/electric/earth) */
  ownerElements?: string[];
  build: (cx: number, cy: number, ownerAngle?: number) => Omit<ComboResult, 'cx' | 'cy'>;
}

const SYNERGY_TABLE: SynergyEntry[] = [
  // ① 수증기 장막: 불 + 물 / 물 + 불
  {
    name: '수증기 장막', icon: '🌫️',
    existingMatch: isIgnite,
    newEffects: ['water'],
    build: (cx, cy) => ({
      name: '수증기 장막', icon: '🌫️',
      damage: 0, radius: 2, stunDuration: 0,
      blind: 2.0,
      fieldCreate: 'fog', fieldCreateDuration: 4,
    }),
  },
  {
    name: '수증기 장막', icon: '🌫️',
    existingMatch: isWater,
    newEffects: ['ignite'],
    build: () => ({
      name: '수증기 장막', icon: '🌫️',
      damage: 0, radius: 2, stunDuration: 0,
      blind: 2.0,
      fieldCreate: 'fog', fieldCreateDuration: 4,
    }),
  },

  // ② 화염 토네이도: 불 + 바람(에리스 element='water'지만 wind 필드)
  //    트리거: ignite 위에 wind 원소 캐릭터의 스킬
  {
    name: '화염 토네이도', icon: '🌪️🔥',
    existingMatch: isIgnite,
    newEffects: [],
    ownerElements: ['water'],  // 에리스는 water element + wind 스킬
    build: (cx, cy, angle) => ({
      name: '화염 토네이도', icon: '🌪️🔥',
      damage: 20, radius: 1, stunDuration: 0,
      burn: 2,
      tornado: { angle: angle ?? 0, speed: 3, duration: 3 },
    }),
  },

  // ③ 산불: grow + fire
  {
    name: '산불', icon: '🔥🌿',
    existingMatch: isGrow,
    newEffects: ['ignite'],
    build: () => ({
      name: '산불', icon: '🔥🌿',
      damage: 15, radius: 3, stunDuration: 0,
      spreadFire: true,
    }),
  },

  // ④ 빙판: freeze + water / water + freeze
  {
    name: '빙판', icon: '🧊',
    existingMatch: isFreeze,
    newEffects: ['water'],
    build: () => ({
      name: '빙판', icon: '🧊',
      damage: 0, radius: 2, stunDuration: 0,
      fieldCreate: 'ice', fieldCreateDuration: 8,
    }),
  },
  {
    name: '빙판', icon: '🧊',
    existingMatch: isWater,
    newEffects: ['freeze'],
    build: () => ({
      name: '빙판', icon: '🧊',
      damage: 0, radius: 2, stunDuration: 0,
      fieldCreate: 'ice', fieldCreateDuration: 8,
    }),
  },

  // ⑤ 감전 확산: water + electric
  {
    name: '감전 확산', icon: '⚡💧',
    existingMatch: isWater,
    newEffects: ['electric'],
    build: () => ({
      name: '감전 확산', icon: '⚡💧',
      damage: 15, radius: 4, stunDuration: 0,
      shock: 2.0,
      electrocute: true,
    }),
  },

  // ⑥ 열충격: freeze + fire
  {
    name: '열충격', icon: '💥❄️',
    existingMatch: isFreeze,
    newEffects: ['ignite'],
    build: () => ({
      name: '열충격', icon: '💥❄️',
      damage: 25, radius: 2, stunDuration: 0,
      slow: { ratio: 0.3, duration: 1 },
    }),
  },

  // ⑦ 용암: mud + fire / ignite + earth
  {
    name: '용암 장판', icon: '🌋',
    existingMatch: isMud,
    newEffects: ['ignite'],
    build: () => ({
      name: '용암 장판', icon: '🌋',
      damage: 0, radius: 2, stunDuration: 0,
      fieldCreate: 'lava', fieldCreateDuration: 6,
    }),
  },
  {
    name: '용암 장판', icon: '🌋',
    existingMatch: isIgnite,
    newEffects: ['mud'],
    build: () => ({
      name: '용암 장판', icon: '🌋',
      damage: 0, radius: 2, stunDuration: 0,
      fieldCreate: 'lava', fieldCreateDuration: 6,
    }),
  },

  // ⑧ 급성장 벽: water + grow / grow + water
  {
    name: '급성장 벽', icon: '🌿🧱',
    existingMatch: isWater,
    newEffects: ['grow'],
    build: () => ({
      name: '급성장 벽', icon: '🌿🧱',
      damage: -20, radius: 2, stunDuration: 0,
      createWall: { hp: 80, duration: 6 },
    }),
  },
  {
    name: '급성장 벽', icon: '🌿🧱',
    existingMatch: isGrow,
    newEffects: ['water'],
    build: () => ({
      name: '급성장 벽', icon: '🌿🧱',
      damage: -20, radius: 2, stunDuration: 0,
      createWall: { hp: 80, duration: 6 },
    }),
  },

  // ⑨ 수렁: mud + water
  {
    name: '수렁', icon: '🪨💧',
    existingMatch: isMud,
    newEffects: ['water'],
    build: () => ({
      name: '수렁', icon: '🪨💧',
      damage: 0, radius: 2, stunDuration: 0,
      fieldCreate: 'swamp', fieldCreateDuration: 8,
      swampSink: true,
    }),
  },

  // ⑩ 블리자드: freeze + wind
  {
    name: '블리자드', icon: '❄️🌪️',
    existingMatch: isFreeze,
    newEffects: [],
    ownerElements: ['water'],  // 에리스
    build: (cx, cy, angle) => ({
      name: '블리자드', icon: '❄️🌪️',
      damage: 8, radius: 3, stunDuration: 0,
      slow: { ratio: 0.3, duration: 4 },
      blizzard: { angle: angle ?? 0, range: 6 },
    }),
  },

  // ⑪ 뿌리 지진: grow + earth
  {
    name: '뿌리 지진', icon: '🌿🪨',
    existingMatch: isGrow,
    newEffects: ['mud'],
    build: () => ({
      name: '뿌리 지진', icon: '🌿🪨',
      damage: 0, radius: 3, stunDuration: 0,
      root: 2,
    }),
  },

  // ⑫ 전기 불꽃: ignite + electric
  {
    name: '전기 불꽃', icon: '⚡🔥',
    existingMatch: isIgnite,
    newEffects: ['electric'],
    build: () => ({
      name: '전기 불꽃', icon: '⚡🔥',
      damage: 10, radius: 3, stunDuration: 0,
      sparkIgnite: true,
    }),
  },

  // ⑬ 꽃가루 폭풍: grow + wind
  {
    name: '꽃가루 폭풍', icon: '🌸🌪️',
    existingMatch: isGrow,
    newEffects: [],
    ownerElements: ['water'],  // 에리스
    build: () => ({
      name: '꽃가루 폭풍', icon: '🌸🌪️',
      damage: 0, radius: 3, stunDuration: 0,
      fieldCreate: 'pollen', fieldCreateDuration: 4,
      pollenSneeze: true,
    }),
  },
];

// ─── 콤보 판정 ───

/**
 * 필드이펙트 적용 전 연계 반응 판정.
 * @param field - 현재 필드 그리드
 * @param newEffect - 새로 적용할 필드이펙트
 * @param cx - 중심 hex col
 * @param cy - 중심 hex row
 * @param gameTime - 게임 시간
 * @param owner - 스킬 사용자 (원소 판정용)
 * @returns 발동된 연계 (없으면 null)
 */
export function checkCombo(
  field: FieldGrid,
  newEffect: string,
  cx: number,
  cy: number,
  gameTime: number,
  owner?: Entity,
): ComboResult | null {
  if (cy < 0 || cy >= field.length || cx < 0 || cx >= (field[0]?.length ?? 0)) return null;

  const cell = field[cy]?.[cx];
  if (!cell) return null;
  const mat = cell.material;

  const ownerAngle = owner?.facingAngle ?? 0;
  const ownerElement = owner?.element ?? '';

  for (const syn of SYNERGY_TABLE) {
    if (!syn.existingMatch(mat)) continue;

    // 매치: 투입 필드이펙트 또는 소유자 원소
    let matched = syn.newEffects.includes(newEffect);
    if (!matched && syn.ownerElements && owner) {
      // 에리스(wind 스킬)는 element가 'water'이지만, 스킬 필드이펙트가 없는 바람 계열
      // ownerElements 체크: 에리스의 스킬은 fieldEffect 없이 발동되므로,
      // 여기서는 owner의 이름이 에리스인지 직접 확인
      if (owner.name === '에리스' || ownerElement === 'nature') {
        matched = true;
      }
    }
    if (!matched) continue;

    // 쿨다운
    const key = `${cx},${cy},${syn.name}`;
    const expiry = comboCooldowns.get(key);
    if (expiry !== undefined && gameTime < expiry) continue;
    comboCooldowns.set(key, gameTime + COMBO_COOLDOWN);

    // 정리
    if (comboCooldowns.size > 100) {
      for (const [k, v] of comboCooldowns) {
        if (gameTime > v) comboCooldowns.delete(k);
      }
    }

    const result = syn.build(cx, cy, ownerAngle);
    return { ...result, cx, cy };
  }

  return null;
}

// ─── 콤보 효과를 엔티티에 적용 ───

export function applyComboEffect(
  combo: ComboResult,
  entities: Entity[],
  ownerTeam: 'A' | 'B' | null,
): Entity[] {
  const affected: Entity[] = [];
  const isHeal = combo.damage < 0;

  for (const e of entities) {
    if (e.dead || e.invincibleTimer > 0) continue;
    if (isHeal && ownerTeam && e.team !== ownerTeam) continue;
    if (!isHeal && ownerTeam && e.team === ownerTeam) continue;

    const dx = e.x - combo.cx;
    const dy = e.y - combo.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= combo.radius) {
      if (isHeal) {
        const heal = Math.abs(combo.damage);
        e.hp = Math.min(e.maxHp, e.hp + heal);
      } else if (combo.damage > 0) {
        // 감전확산: 넓을수록 개별 데미지 감소
        let dmg = combo.damage;
        if (combo.electrocute) {
          dmg = Math.round(combo.damage * 0.7 * Math.max(0.3, 1 - dist / 8));
        }
        e.hp -= dmg;
        if (combo.stunDuration > 0) {
          e.stunTimer = Math.max(e.stunTimer, combo.stunDuration);
        }
      }
      // 추가 CC
      if (combo.root && combo.root > 0) {
        e.rootTimer = Math.max(e.rootTimer, combo.root);
      }
      if (combo.slow) {
        e.slowRatio = Math.max(e.slowRatio, combo.slow.ratio);
        e.slowTimer = Math.max(e.slowTimer, combo.slow.duration);
      }
      if (combo.burn && combo.burn > 0) {
        e.burnTimer = Math.max(e.burnTimer, combo.burn);
      }
      if (combo.shock && combo.shock > 0) {
        e.shockTimer = Math.max(e.shockTimer, combo.shock);
      }
      if (combo.blind && combo.blind > 0) {
        e.blindTimer = Math.max(e.blindTimer, combo.blind);
      }
      if (combo.freeze && combo.freeze > 0) {
        e.freezeTimer = Math.max(e.freezeTimer, combo.freeze);
      }
      affected.push(e);
    }
  }

  return affected;
}
