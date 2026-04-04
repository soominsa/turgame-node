/**
 * glyph-forge.ts — 글리프 제작 로직
 *
 * 입력: wallet, glyphType, grade, 재료 보유량, NFT 여부, 현재 인벤토리 수
 * 처리: 자격 확인 → 타입-등급 호환 → 상한 확인 → 비용 차감
 * 출력: Glyph 객체
 */

import type { CraftCost } from './sigil-types';
import {
  type Glyph, type GlyphGrade, type GlyphTypeId,
  GLYPH_CRAFT_COST, GLYPH_GRADE_ACCESS, GLYPH_MAX_INVENTORY,
  isPassiveGlyph, ACTIVE_GLYPHS,
} from './glyph-types';

// ── 제작 입력 ──

export interface ForgeGlyphInput {
  wallet: string;
  glyphType: GlyphTypeId;
  grade: GlyphGrade;
  materials: { wood: number; soil: number };
  hasNftCharacter: boolean;
  currentInventoryCount: number;
}

export interface ForgeGlyphResult {
  glyph: Glyph;
  cost: CraftCost;
}

// ── 타입-등급 호환 검사 ──

const GRADE_ORDER: Record<GlyphGrade, number> = { Common: 0, Uncommon: 1, Rare: 2 };

function isGlyphTypeAvailableAtGrade(glyphType: GlyphTypeId, grade: GlyphGrade): boolean {
  // Common → 패시브만
  if (GRADE_ORDER[grade] === 0) return isPassiveGlyph(glyphType);
  // Uncommon/Rare → 해당 등급 이상이면 사용 가능
  if (!isPassiveGlyph(glyphType)) {
    const def = ACTIVE_GLYPHS[glyphType as keyof typeof ACTIVE_GLYPHS];
    return GRADE_ORDER[grade] >= GRADE_ORDER[def.gradeMin];
  }
  return true;
}

// ── 메인 제작 함수 ──

export function forgeGlyph(input: ForgeGlyphInput): ForgeGlyphResult {
  const { wallet, glyphType, grade, materials, hasNftCharacter, currentInventoryCount } = input;

  // 1. 등급 제작 자격 확인
  const allowedGrades = hasNftCharacter ? GLYPH_GRADE_ACCESS.nft : GLYPH_GRADE_ACCESS.free;
  if (!allowedGrades.includes(grade)) {
    throw new Error(`${grade} 글리프는 NFT 캐릭터 보유자만 제작 가능`);
  }

  // 2. 타입-등급 호환 확인
  if (!isGlyphTypeAvailableAtGrade(glyphType, grade)) {
    throw new Error(`${glyphType}은(는) ${grade} 등급에서 제작할 수 없음`);
  }

  // 3. 인벤토리 상한 확인
  if (currentInventoryCount >= GLYPH_MAX_INVENTORY) {
    throw new Error(`글리프 인벤토리 상한 초과 (최대 ${GLYPH_MAX_INVENTORY}개)`);
  }

  // 4. 비용 확인
  const cost = GLYPH_CRAFT_COST[grade];
  if (materials.wood < cost.wood || materials.soil < cost.soil) {
    throw new Error('재료 부족');
  }

  const glyph: Glyph = {
    id: 0, // DB에서 할당
    ownerWallet: wallet,
    glyphType,
    grade,
    createdAt: new Date().toISOString(),
  };

  return { glyph, cost };
}
