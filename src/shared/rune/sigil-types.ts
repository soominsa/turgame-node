/**
 * sigil-types.ts — 시길(Sigil) 타입, 능력치 풀, 원소 매핑, 시너지 규칙
 *
 * 영구 룬(시길)의 모든 상수와 타입을 정의한다.
 * 캐릭터에 장착하여 스탯을 % 보정하고, 원소/스탯/역할 시너지를 발동.
 */

// ── 원소 매핑 (기존 ElementType 재활용) ──
// 기획서: Fire/Water/Earth/Growth
// 코드:   'fire' | 'water' | 'earth' | 'nature'  (Growth = nature)

export type SigilElement = 'fire' | 'water' | 'earth' | 'nature';
export type SigilGrade = 'Common' | 'Uncommon' | 'Rare' | 'Legendary';

/** UI 표시용 원소 이름 */
export const ELEMENT_DISPLAY_NAME: Record<SigilElement, string> = {
  fire: '불',
  water: '물',
  earth: '흙',
  nature: '성장',
};

// ── 능력치 풀 ──

export const SIGIL_STAT_POOL = {
  // 공격 계열
  attackDamage:   { min: 2, max: 10, category: 'attack' as const },
  attackSpeed:    { min: 3, max: 12, category: 'attack' as const },
  attackRange:    { min: 2, max: 8,  category: 'attack' as const },
  skillDamage:    { min: 3, max: 10, category: 'attack' as const },
  critChance:     { min: 1, max: 8,  category: 'attack' as const },
  critDamage:     { min: 5, max: 20, category: 'attack' as const },
  // 방어 계열
  hp:             { min: 3, max: 12, category: 'defense' as const },
  defense:        { min: 2, max: 8,  category: 'defense' as const },
  healReceived:   { min: 3, max: 10, category: 'defense' as const },
  ccResist:       { min: 5, max: 15, category: 'defense' as const },
  // 유틸 계열
  speed:          { min: 2, max: 8,  category: 'utility' as const },
  cooldownReduce: { min: 2, max: 8,  category: 'utility' as const },
  ultCharge:      { min: 3, max: 10, category: 'utility' as const },
  healPower:      { min: 3, max: 10, category: 'utility' as const },
  captureSpeed:   { min: 5, max: 15, category: 'utility' as const },
} as const;

export type SigilStatKey = keyof typeof SIGIL_STAT_POOL;
export type StatCategory = 'attack' | 'defense' | 'utility';

/** 스탯 키 → 카테고리 빠른 조회 */
export const STAT_CATEGORY: Record<SigilStatKey, StatCategory> = Object.fromEntries(
  (Object.entries(SIGIL_STAT_POOL) as [SigilStatKey, { category: StatCategory }][])
    .map(([k, v]) => [k, v.category])
) as Record<SigilStatKey, StatCategory>;

// ── 등급별 롤링 규칙 ──

export interface GradeRule {
  /** 주 능력치 범위 비율 [min, max] (0.0~1.0) */
  primaryRange: [number, number];
  /** 부 능력치 개수 */
  secondaryCount: number;
  /** 부 능력치 범위 비율 */
  secondaryRange: [number, number];
  /** 고유 효과 유무 */
  hasUniqueEffect: boolean;
}

export const GRADE_RULES: Record<SigilGrade, GradeRule> = {
  Common:    { primaryRange: [0.0, 0.5], secondaryCount: 0, secondaryRange: [0, 0],     hasUniqueEffect: false },
  Uncommon:  { primaryRange: [0.0, 0.5], secondaryCount: 1, secondaryRange: [0.0, 0.3], hasUniqueEffect: false },
  Rare:      { primaryRange: [0.5, 1.0], secondaryCount: 2, secondaryRange: [0.0, 0.5], hasUniqueEffect: false },
  Legendary: { primaryRange: [0.7, 1.0], secondaryCount: 3, secondaryRange: [0.5, 0.8], hasUniqueEffect: true  },
};

// ── 고유 효과 (Legendary 전용) ──

export const UNIQUE_EFFECTS = {
  fire_afterimage:  { element: 'fire'   as SigilElement, desc: '킬 시 3초간 이속 +20%' },
  water_cascade:    { element: 'water'  as SigilElement, desc: '스킬 적중 시 15% 확률 쿨다운 초기화' },
  earth_fortitude:  { element: 'earth'  as SigilElement, desc: 'HP 30% 이하 시 방어력 2배' },
  nature_cycle:     { element: 'nature' as SigilElement, desc: '힐 시 10% 확률로 주변 아군 50% 힐' },
  crystal_reflect:  { element: 'earth'  as SigilElement, desc: '피격 시 5% 확률로 피해 반사' },
  storm_absorb:     { element: 'fire'   as SigilElement, desc: 'CC 무효화 시 궁극기 충전 +15' },
} as const;

export type UniqueEffectId = keyof typeof UNIQUE_EFFECTS;

// ── 시길 데이터 ──

export interface SigilSecondary {
  stat: SigilStatKey;
  value: number;
}

export interface Sigil {
  id: number;
  ownerWallet: string;
  grade: SigilGrade;
  element: SigilElement;
  primaryStat: SigilStatKey;
  primaryValue: number;                // % 단위 (예: 7 = +7%)
  secondaries: SigilSecondary[];
  uniqueEffect?: UniqueEffectId;
  fortemStatus: 'LOCAL' | 'MINTED' | 'REDEEMED';
  createdAt: string;
}

// ── 시길 효과 (엔진 적용용) ──

export interface SigilEffect {
  statModifiers: Map<string, number>;  // 'attackDamage' → 0.07 (= +7%)
  synergies: string[];                 // ['원소 공명', '전사의 기세']
  uniqueEffect?: UniqueEffectId;
}

// ── 원소 상생 관계 (자원순환 기반) ──
// Water → Nature → Earth → Fire → Water

export const ELEMENT_SYNERGY: Record<SigilElement, SigilElement> = {
  water: 'nature',
  nature: 'earth',
  earth: 'fire',
  fire: 'water',
};

// ── 원소 매칭 보너스 ──

export const ELEMENT_MATCH_BONUS = {
  /** 완전 일치: 주 능력치 +30% */
  exact: 0.30,
  /** 상생 일치: +15% */
  synergy: 0.15,
  /** 불일치: 페널티 없음 */
  mismatch: 0,
} as const;

// ── 동원소 시너지 보너스 ──

export const MONO_ELEMENT_SYNERGY: Record<number, { name: string; bonus: number }> = {
  2: { name: '원소 공명',  bonus: 0.10 },
  3: { name: '원소 집중',  bonus: 0.25 },
  4: { name: '원소 지배',  bonus: 0.40 },
  5: { name: '원소 초월',  bonus: 0.60 },
};

// ── 이원소 시너지 (상생 2+2 조합) ──

export interface DualSynergy {
  name: string;
  elements: [SigilElement, SigilElement];
  effects: Partial<Record<SigilStatKey, number>>;
}

export const DUAL_ELEMENT_SYNERGIES: DualSynergy[] = [
  { name: '용광로',    elements: ['fire', 'earth'],   effects: { attackDamage: 5, defense: 5 } },
  { name: '오아시스',  elements: ['water', 'nature'],  effects: { healPower: 8, speed: 3 } },
  { name: '대지의 힘', elements: ['earth', 'nature'],  effects: { hp: 8, ccResist: 5 } },
  { name: '증기 폭발', elements: ['fire', 'water'],    effects: { skillDamage: 6, cooldownReduce: 3 } },
];

// ── 스탯 시너지 (같은 계열 3개+) ──

export const STAT_SYNERGIES: Record<StatCategory, { name: string; stat: SigilStatKey; bonus: number }> = {
  attack:  { name: '전사의 기세',  stat: 'attackDamage',   bonus: 3 },
  defense: { name: '철벽 수호',    stat: 'defense',        bonus: 3 },
  utility: { name: '전장의 지혜',  stat: 'cooldownReduce', bonus: 3 },
};

export const BALANCED_SYNERGY = { name: '균형의 달인', bonus: 2 };

// ── 역할 특화 시너지 ──

export type CombatRole = 'ranged' | 'melee' | 'tank' | 'support';

export interface RoleSynergy {
  role: CombatRole;
  name: string;
  requiredCategory: StatCategory;
  requiredCount: number;
  effect: Partial<Record<SigilStatKey, number>>;
}

export const ROLE_SYNERGIES: RoleSynergy[] = [
  { role: 'ranged',  name: '명사수',   requiredCategory: 'attack',  requiredCount: 3, effect: { attackRange: 5 } },
  { role: 'melee',   name: '암살자',   requiredCategory: 'attack',  requiredCount: 2, effect: { critDamage: 10 } },
  { role: 'tank',    name: '불굴',     requiredCategory: 'defense', requiredCount: 3, effect: { defense: 8 } },
  { role: 'support', name: '수호천사', requiredCategory: 'utility', requiredCount: 2, effect: { healPower: 5 } },
];

// ── 제작 비용 ──

export interface CraftCost {
  wood: number;
  soil: number;
}

export const SIGIL_CRAFT_COST: Record<SigilGrade, CraftCost> = {
  Common:    { wood: 30,  soil: 10  },
  Uncommon:  { wood: 60,  soil: 20  },
  Rare:      { wood: 120, soil: 40  },
  Legendary: { wood: 250, soil: 80  },
};
