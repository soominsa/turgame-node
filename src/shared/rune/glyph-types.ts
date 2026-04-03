/**
 * glyph-types.ts — 글리프(Glyph) 타입, 패시브/스킬 정의
 *
 * 소모 룬(글리프)의 모든 상수와 타입을 정의한다.
 * 매치 중 1~2회 사용 후 소멸. 계정(게이머) 단위 장착.
 */

import type { CraftCost } from './sigil-types';

export type GlyphGrade = 'Common' | 'Uncommon' | 'Rare';

// ── 패시브 글리프 (매치 시작 시 자동 발동) ──

export const PASSIVE_GLYPHS = {
  stability:  { stat: 'defense'     as const, value: 10, duration: 15, desc: '아군 전체 방어력 +10%' },
  swiftness:  { stat: 'speed'       as const, value: 8,  duration: 10, desc: '아군 전체 이속 +8%' },
  focus:      { stat: 'attackSpeed' as const, value: 12, duration: 8,  desc: '아군 전체 공격속도 +12%' },
  regen:      { stat: 'hpRegen'     as const, value: 1,  duration: 12, desc: '아군 전체 초당 HP 1% 회복' },
} as const;

export type PassiveGlyphId = keyof typeof PASSIVE_GLYPHS;

// ── 스킬 글리프 (플레이어 직접 발동, 영역 지정) ──

export const ACTIVE_GLYPHS = {
  flame_spread:  { desc: '지정 영역 나무→불 전환',       radius: 2, gradeMin: 'Uncommon' as GlyphGrade },
  rapid_growth:  { desc: '지정 영역 나무 즉시 생성',     radius: 2, gradeMin: 'Uncommon' as GlyphGrade },
  flood:         { desc: '지정 영역 물 생성+확산',        radius: 2, gradeMin: 'Uncommon' as GlyphGrade },
  earth_seal:    { desc: '지정 영역 타일 변화 5초 차단',  radius: 2, gradeMin: 'Rare'     as GlyphGrade },
  overcharge:    { desc: '아군 1명 3초간 타일 효과 무시',  radius: 0, gradeMin: 'Rare'     as GlyphGrade },
  reconfigure:   { desc: '지정 영역 타일 랜덤 변경',      radius: 2, gradeMin: 'Rare'     as GlyphGrade },
} as const;

export type ActiveGlyphId = keyof typeof ACTIVE_GLYPHS;
export type GlyphTypeId = PassiveGlyphId | ActiveGlyphId;

/** 패시브인지 판별 */
export function isPassiveGlyph(id: GlyphTypeId): id is PassiveGlyphId {
  return id in PASSIVE_GLYPHS;
}

/** 액티브인지 판별 */
export function isActiveGlyph(id: GlyphTypeId): id is ActiveGlyphId {
  return id in ACTIVE_GLYPHS;
}

// ── 글리프 데이터 ──

export interface Glyph {
  id: number;
  ownerWallet: string;
  glyphType: GlyphTypeId;
  grade: GlyphGrade;
  createdAt: string;
}

// ── 글리프 효과 (엔진 적용용) ──

export interface GlyphEffect {
  type: 'passive' | 'active';
  glyphType: GlyphTypeId;
  grade: GlyphGrade;
  used: boolean;                      // 스킬 글리프: 사용 여부
  remainingDuration?: number;         // 패시브 글리프: 남은 시간(초)
}

// ── 제작 비용 ──

export const GLYPH_CRAFT_COST: Record<GlyphGrade, CraftCost> = {
  Common:   { wood: 5,  heat: 3,  water: 0 },
  Uncommon: { wood: 15, heat: 8,  water: 0 },
  Rare:     { wood: 30, heat: 15, water: 5 },
};

// ── 제작 자격 (캐릭터 NFT 여부) ──

export const GLYPH_GRADE_ACCESS = {
  free: ['Common', 'Uncommon'] as GlyphGrade[],
  nft:  ['Common', 'Uncommon', 'Rare'] as GlyphGrade[],
};

/** 글리프 인벤토리 최대 보유 수 */
export const GLYPH_MAX_INVENTORY = 20;

/** 글리프 슬롯 수 (Phase 1: 1, Phase 2: 2) */
export const GLYPH_SLOT_COUNT = 2;

/** Rare 글리프 효과량 증가 (약 +20%) */
export const RARE_GLYPH_BONUS = 0.20;
