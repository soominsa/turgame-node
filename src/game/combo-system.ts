/**
 * 원소 콤보 시스템 — 필드이펙트 겹침 시 추가 효과 발동
 * applyFieldEffect() 호출 시 기존 타일 상태와 새 효과를 매칭하여 콤보 판정
 */

import type { Entity } from '../shared/combat-entities.js';
import type { FieldGrid, Material } from '../core/types.js';

// ─── 타입 ───

export interface ComboResult {
  name: string;           // "감전", "수증기 폭발" 등
  icon: string;           // 이모지
  damage: number;         // 추가 대미지 (음수=힐)
  radius: number;         // 효과 범위 (hex 타일 수)
  stunDuration: number;   // 추가 스턴 (초)
  cx: number;             // 중심 hex col
  cy: number;             // 중심 hex row
}

// 콤보 쿨다운 캐시: "col,row,comboName" → 만료시간
const comboCooldowns = new Map<string, number>();
const COMBO_COOLDOWN = 3; // 같은 위치 같은 콤보 3초 쿨

/** 쿨다운 맵 초기화 (게임 리셋 시 호출) */
export function resetComboCooldowns() {
  comboCooldowns.clear();
}

// ─── 콤보 테이블 ───

interface ComboEntry {
  name: string;
  icon: string;
  /** 기존 타일 상태 판별 함수 */
  existingMatch: (mat: Material | null) => boolean;
  /** 새로 적용되는 필드이펙트 */
  newEffect: string;
  damage: number;
  radius: number;
  stunDuration: number;
}

const COMBO_TABLE: ComboEntry[] = [
  // ⚡ 감전: 물 타일 위에 불(ignite) → 전기 방전
  {
    name: '감전', icon: '⚡',
    existingMatch: (m) => m !== null && m.type === 'water' && m.thermalState !== 'frozen',
    newEffect: 'ignite',
    damage: 15, radius: 3, stunDuration: 1.0,
  },
  // 💥 수증기 폭발: 불타는 타일 위에 물(water) → 급격한 증발
  {
    name: '수증기 폭발', icon: '💥',
    existingMatch: (m) => m !== null && (m.thermalState === 'burning' || m.temperature > 200),
    newEffect: 'water',
    damage: 25, radius: 2, stunDuration: 0.5,
  },
  // 🌿 급성장: 물 타일 위에 나무(grow) → 즉시 성장 + 치유
  {
    name: '급성장', icon: '🌿',
    existingMatch: (m) => m !== null && m.type === 'water' && m.thermalState === 'normal',
    newEffect: 'grow',
    damage: -20, radius: 3, stunDuration: 0,
  },
  // 🔥 대화재: 나무 타일 위에 불(ignite) → 연쇄 화재
  {
    name: '대화재', icon: '🔥',
    existingMatch: (m) => m !== null && m.type === 'wood' && m.thermalState === 'normal',
    newEffect: 'ignite',
    damage: 18, radius: 4, stunDuration: 0,
  },
  // 🪨 진흙 함정: 진흙 위에 빙결(freeze) → 얼어붙은 진흙
  {
    name: '진흙 함정', icon: '🪨',
    existingMatch: (m) => m !== null && m.type === 'soil' && m.thermalState === 'damp',
    newEffect: 'freeze',
    damage: 5, radius: 2, stunDuration: 2.0,
  },
  // 🧊 영구 동토: 얼음 위에 진흙(mud) → 동토
  {
    name: '영구 동토', icon: '🧊',
    existingMatch: (m) => m !== null && m.type === 'water' && m.thermalState === 'frozen',
    newEffect: 'mud',
    damage: 8, radius: 3, stunDuration: 1.5,
  },
  // 🌊 해일: 물 위에 물(water) → 범위 확장 + 대미지
  {
    name: '해일', icon: '🌊',
    existingMatch: (m) => m !== null && m.type === 'water' && m.thermalState === 'normal',
    newEffect: 'water',
    damage: 10, radius: 4, stunDuration: 0.3,
  },
];

// ─── 콤보 판정 ───

/**
 * 필드이펙트 적용 전 콤보 판정.
 * @param field - 현재 필드 그리드
 * @param newEffect - 새로 적용할 필드이펙트
 * @param cx - 중심 hex col
 * @param cy - 중심 hex row
 * @param gameTime - 현재 게임 시간 (쿨다운 체크용)
 * @returns 발동된 콤보 (없으면 null)
 */
export function checkCombo(
  field: FieldGrid,
  newEffect: string,
  cx: number,
  cy: number,
  gameTime: number,
): ComboResult | null {
  // 필드 범위 체크
  if (cy < 0 || cy >= field.length || cx < 0 || cx >= (field[0]?.length ?? 0)) return null;

  const cell = field[cy]?.[cx];
  if (!cell) return null;
  const mat = cell.material;

  for (const combo of COMBO_TABLE) {
    if (combo.newEffect !== newEffect) continue;
    if (!combo.existingMatch(mat)) continue;

    // 쿨다운 체크
    const key = `${cx},${cy},${combo.name}`;
    const expiry = comboCooldowns.get(key);
    if (expiry !== undefined && gameTime < expiry) continue;

    // 쿨다운 설정
    comboCooldowns.set(key, gameTime + COMBO_COOLDOWN);

    // 오래된 쿨다운 정리 (100개 넘으면)
    if (comboCooldowns.size > 100) {
      for (const [k, v] of comboCooldowns) {
        if (gameTime > v) comboCooldowns.delete(k);
      }
    }

    return {
      name: combo.name,
      icon: combo.icon,
      damage: combo.damage,
      radius: combo.radius,
      stunDuration: combo.stunDuration,
      cx, cy,
    };
  }

  return null;
}

/**
 * 콤보 효과를 엔티티에 적용 (game-engine에서 호출)
 * @param combo - 발동된 콤보
 * @param entities - 전체 엔티티 목록
 * @param ownerTeam - 콤보 발동자 팀 (null이면 팀 무관)
 * @returns 피격된 엔티티 목록
 */
export function applyComboEffect(
  combo: ComboResult,
  entities: Entity[],
  ownerTeam: 'A' | 'B' | null,
): Entity[] {
  const affected: Entity[] = [];
  const isHeal = combo.damage < 0;

  for (const e of entities) {
    if (e.dead || e.invincibleTimer > 0) continue;

    // 힐이면 아군에게, 대미지면 적군에게
    if (isHeal && ownerTeam && e.team !== ownerTeam) continue;
    if (!isHeal && ownerTeam && e.team === ownerTeam) continue;

    const dx = e.x - combo.cx;
    const dy = e.y - combo.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= combo.radius) {
      if (isHeal) {
        const heal = Math.abs(combo.damage);
        e.hp = Math.min(e.maxHp, e.hp + heal);
      } else {
        e.hp -= combo.damage;
        if (combo.stunDuration > 0) {
          e.stunTimer = Math.max(e.stunTimer, combo.stunDuration);
        }
      }
      affected.push(e);
    }
  }

  return affected;
}
