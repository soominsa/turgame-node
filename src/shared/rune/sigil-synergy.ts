/**
 * sigil-synergy.ts — 시너지 판정
 *
 * 입력: characterId, equippedSigils[]
 * 처리: 원소 매칭 → 동원소 → 이원소 → 스탯 → 역할 시너지 판정
 * 출력: SigilEffect { statModifiers, synergies[], uniqueEffect? }
 */

import {
  type Sigil, type SigilElement, type SigilStatKey, type SigilEffect,
  type CombatRole, type UniqueEffectId, type StatCategory,
  ELEMENT_SYNERGY, ELEMENT_MATCH_BONUS,
  MONO_ELEMENT_SYNERGY, DUAL_ELEMENT_SYNERGIES,
  STAT_SYNERGIES, BALANCED_SYNERGY, ROLE_SYNERGIES,
  STAT_CATEGORY, SIGIL_STAT_POOL,
} from './sigil-types';

// ── 캐릭터 정보 (외부에서 주입) ──

export interface CharacterRuneInfo {
  id: string;
  element: SigilElement;
  combatRole: CombatRole;
}

// ── 스탯 누산기 ──

function addStat(mods: Map<string, number>, stat: SigilStatKey, percent: number) {
  const prev = mods.get(stat) ?? 0;
  mods.set(stat, prev + percent / 100);
}

function addAllStats(mods: Map<string, number>, percent: number) {
  for (const key of Object.keys(SIGIL_STAT_POOL) as SigilStatKey[]) {
    addStat(mods, key, percent);
  }
}

// ── 메인 시너지 판정 ──

export function calculateSigilEffect(
  character: CharacterRuneInfo,
  sigils: Sigil[],
): SigilEffect {
  const statModifiers = new Map<string, number>();
  const synergies: string[] = [];
  let uniqueEffect: UniqueEffectId | undefined;

  if (sigils.length === 0) return { statModifiers, synergies };

  // ── 1. 각 시길의 기본 스탯 적용 + 원소 매칭 보너스 ──
  for (const sigil of sigils) {
    // 주 능력치
    let primaryBonus = 0;
    if (sigil.element === character.element) {
      primaryBonus = ELEMENT_MATCH_BONUS.exact;
    } else if (ELEMENT_SYNERGY[sigil.element] === character.element
            || ELEMENT_SYNERGY[character.element] === sigil.element) {
      primaryBonus = ELEMENT_MATCH_BONUS.synergy;
    }

    const effectivePrimary = sigil.primaryValue * (1 + primaryBonus);
    addStat(statModifiers, sigil.primaryStat, effectivePrimary);

    // 부 능력치 (원소 매칭 보너스 미적용)
    for (const sec of sigil.secondaries) {
      addStat(statModifiers, sec.stat, sec.value);
    }

    // 고유 효과 (마지막 Legendary 시길 우선)
    if (sigil.uniqueEffect) {
      uniqueEffect = sigil.uniqueEffect;
    }
  }

  // ── 2. 동원소 시너지 판정 ──
  const elementCounts = new Map<SigilElement, number>();
  for (const sigil of sigils) {
    elementCounts.set(sigil.element, (elementCounts.get(sigil.element) ?? 0) + 1);
  }

  for (const [, count] of elementCounts) {
    const syn = MONO_ELEMENT_SYNERGY[count];
    if (syn) {
      synergies.push(syn.name);
      // 동원소 시너지는 주 능력치 매칭 보너스에 추가 %
      // → 이미 적용된 주 능력치에 bonus만큼 추가
      for (const sigil of sigils) {
        addStat(statModifiers, sigil.primaryStat, sigil.primaryValue * syn.bonus);
      }
    }
  }

  // ── 3. 이원소 시너지 판정 (상생 2+2 조합) ──
  for (const dual of DUAL_ELEMENT_SYNERGIES) {
    const [e1, e2] = dual.elements;
    if ((elementCounts.get(e1) ?? 0) >= 2 && (elementCounts.get(e2) ?? 0) >= 2) {
      synergies.push(dual.name);
      for (const [stat, value] of Object.entries(dual.effects)) {
        addStat(statModifiers, stat as SigilStatKey, value!);
      }
    }
  }

  // ── 4. 스탯 시너지 (같은 계열 3개+) ──
  const categoryCounts: Record<StatCategory, number> = { attack: 0, defense: 0, utility: 0 };
  const allStats = new Set<SigilStatKey>();

  for (const sigil of sigils) {
    allStats.add(sigil.primaryStat);
    categoryCounts[STAT_CATEGORY[sigil.primaryStat]]++;
    for (const sec of sigil.secondaries) {
      allStats.add(sec.stat);
      categoryCounts[STAT_CATEGORY[sec.stat]]++;
    }
  }

  let hasStatSynergy = false;
  for (const cat of ['attack', 'defense', 'utility'] as StatCategory[]) {
    if (categoryCounts[cat] >= 3) {
      const syn = STAT_SYNERGIES[cat];
      synergies.push(syn.name);
      addStat(statModifiers, syn.stat, syn.bonus);
      hasStatSynergy = true;
    }
  }

  // 혼합 시너지 (각 카테고리 1개 이상, 스탯 시너지 미발동 시)
  if (!hasStatSynergy
    && categoryCounts.attack >= 1
    && categoryCounts.defense >= 1
    && categoryCounts.utility >= 1) {
    synergies.push(BALANCED_SYNERGY.name);
    addAllStats(statModifiers, BALANCED_SYNERGY.bonus);
  }

  // ── 5. 역할 특화 시너지 ──
  for (const rs of ROLE_SYNERGIES) {
    if (rs.role !== character.combatRole) continue;
    if (categoryCounts[rs.requiredCategory] >= rs.requiredCount) {
      synergies.push(rs.name);
      for (const [stat, value] of Object.entries(rs.effect)) {
        addStat(statModifiers, stat as SigilStatKey, value!);
      }
    }
  }

  return { statModifiers, synergies, uniqueEffect };
}
