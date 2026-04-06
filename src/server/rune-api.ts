/**
 * rune-api.ts — 룬 시스템 REST/WS 핸들러 + ForTem NFT 연동
 *
 * 시길/글리프 제작, 장착, 조회 API.
 * ForTem 연동은 시길 NFT 민팅 요청만 처리 (실제 민팅은 중앙서버에서).
 */

import type { Sigil, SigilGrade, SigilElement, SigilStatKey } from '@shared/rune/sigil-types.js';
import type { Glyph, GlyphGrade, GlyphTypeId } from '@shared/rune/glyph-types.js';
import { forgeSigil, type MaterialBalance } from '@shared/rune/sigil-forge.js';
import { forgeGlyph } from '@shared/rune/glyph-forge.js';
import { calculateSigilEffect, type CharacterRuneInfo } from '@shared/rune/sigil-synergy.js';

// ── DB 인터페이스 (실제 구현은 중앙서버에서 SQLite/Postgres 제공) ──

export interface RuneDB {
  // 시길
  insertSigil(sigil: Sigil): Promise<number>;
  getSigilsByWallet(wallet: string): Promise<Sigil[]>;
  getSigilById(id: number): Promise<Sigil | null>;
  deleteSigil(id: number): Promise<void>;
  updateSigilFortem(id: number, status: string, redeemCode?: string): Promise<void>;
  // 시길 장착
  getEquippedSigils(wallet: string, characterId: string): Promise<Sigil[]>;
  equipSigil(wallet: string, characterId: string, slotIndex: number, sigilId: number): Promise<void>;
  unequipSigil(wallet: string, characterId: string, slotIndex: number): Promise<void>;
  // 글리프
  insertGlyph(glyph: Glyph): Promise<number>;
  getGlyphsByWallet(wallet: string): Promise<Glyph[]>;
  deleteGlyph(id: number): Promise<void>;
  getGlyphCount(wallet: string): Promise<number>;
  // 글리프 장착
  equipGlyph(wallet: string, slotIndex: number, glyphId: number): Promise<void>;
  getEquippedGlyphs(wallet: string): Promise<Glyph[]>;
  clearEquippedGlyphs(wallet: string): Promise<void>;
  deleteEquippedGlyphs(wallet: string): Promise<void>;
  // 재료
  getMaterials(wallet: string): Promise<MaterialBalance>;
  deductMaterials(wallet: string, cost: { wood: number; soil: number }): Promise<void>;
}

// ── API 핸들러 ──

export interface RuneApiContext {
  db: RuneDB;
  /** 포르템 민팅 함수 (중앙서버에서 주입) */
  mintSigilNFT?: (sigil: Sigil, wallet: string) => Promise<{ redeemCode: string }>;
}

/** 시길 제작 */
export async function handleForgeSigil(
  ctx: RuneApiContext,
  wallet: string,
  grade: SigilGrade,
  hasNftCharacter: boolean,
  totalMatches: number,
  totalSeed: number,
) {
  const materials = await ctx.db.getMaterials(wallet);
  const serverNonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { sigil, cost } = forgeSigil({
    wallet, grade, materials, serverNonce,
    hasNftCharacter, totalMatches, totalSeed,
  });

  await ctx.db.deductMaterials(wallet, cost);
  const id = await ctx.db.insertSigil(sigil);
  sigil.id = id;

  return sigil;
}

/** 글리프 제작 */
export async function handleForgeGlyph(
  ctx: RuneApiContext,
  wallet: string,
  glyphType: GlyphTypeId,
  grade: GlyphGrade,
  hasNftCharacter: boolean,
) {
  const materials = await ctx.db.getMaterials(wallet);
  const currentCount = await ctx.db.getGlyphCount(wallet);

  const { glyph, cost } = forgeGlyph({
    wallet, glyphType, grade, materials,
    hasNftCharacter, currentInventoryCount: currentCount,
  });

  await ctx.db.deductMaterials(wallet, cost);
  const id = await ctx.db.insertGlyph(glyph);
  glyph.id = id;

  return glyph;
}

/** 시길 장착 */
export async function handleEquipSigil(
  ctx: RuneApiContext,
  wallet: string,
  characterId: string,
  slotIndex: number,
  sigilId: number,
) {
  const sigil = await ctx.db.getSigilById(sigilId);
  if (!sigil || sigil.ownerWallet !== wallet) throw new Error('시길을 찾을 수 없음');
  if (slotIndex < 0 || slotIndex > 4) throw new Error('유효하지 않은 슬롯');

  await ctx.db.equipSigil(wallet, characterId, slotIndex, sigilId);
}

/** 시길 해제 */
export async function handleUnequipSigil(
  ctx: RuneApiContext,
  wallet: string,
  characterId: string,
  slotIndex: number,
) {
  await ctx.db.unequipSigil(wallet, characterId, slotIndex);
}

/** 시길 효과 계산 (매치 시작 시) */
export async function handleCalculateSigilEffect(
  ctx: RuneApiContext,
  wallet: string,
  character: CharacterRuneInfo,
) {
  const sigils = await ctx.db.getEquippedSigils(wallet, character.id);
  return calculateSigilEffect(character, sigils);
}

/** 시길 목록 조회 */
export async function handleListSigils(ctx: RuneApiContext, wallet: string) {
  return ctx.db.getSigilsByWallet(wallet);
}

/** 글리프 목록 조회 */
export async function handleListGlyphs(ctx: RuneApiContext, wallet: string) {
  return ctx.db.getGlyphsByWallet(wallet);
}

/** 글리프 장착 (매치 전 세팅) */
export async function handleEquipGlyph(
  ctx: RuneApiContext,
  wallet: string,
  slotIndex: number,
  glyphId: number,
) {
  if (slotIndex < 0 || slotIndex > 1) throw new Error('유효하지 않은 슬롯');
  await ctx.db.equipGlyph(wallet, slotIndex, glyphId);
}

/** 매치 종료 시 글리프 소멸 */
export async function handleConsumeGlyphs(ctx: RuneApiContext, wallet: string) {
  const equipped = await ctx.db.getEquippedGlyphs(wallet);
  for (const g of equipped) {
    await ctx.db.deleteGlyph(g.id);
  }
  await ctx.db.clearEquippedGlyphs(wallet);
}

// ── ForTem NFT 연동 ──

/** 시길 NFT 민팅 요청 */
export async function handleMintSigilNFT(
  ctx: RuneApiContext,
  wallet: string,
  sigilId: number,
) {
  if (!ctx.mintSigilNFT) throw new Error('ForTem 연동 미설정');

  const sigil = await ctx.db.getSigilById(sigilId);
  if (!sigil) throw new Error('시길을 찾을 수 없음');
  if (sigil.ownerWallet !== wallet) throw new Error('소유자 불일치');
  if (sigil.fortemStatus !== 'LOCAL') throw new Error('이미 민팅되었거나 리딤된 시길');

  const { redeemCode } = await ctx.mintSigilNFT(sigil, wallet);
  await ctx.db.updateSigilFortem(sigilId, 'MINTED', redeemCode);

  return { redeemCode };
}

// ── WS 메시지 라우터 ──

export type RuneMessage =
  | { type: 'forge_sigil'; grade: SigilGrade }
  | { type: 'forge_glyph'; glyphType: GlyphTypeId; grade: GlyphGrade }
  | { type: 'equip_sigil'; characterId: string; slotIndex: number; sigilId: number }
  | { type: 'unequip_sigil'; characterId: string; slotIndex: number }
  | { type: 'equip_glyph'; slotIndex: number; glyphId: number }
  | { type: 'list_sigils' }
  | { type: 'list_glyphs' }
  | { type: 'mint_sigil'; sigilId: number };

export async function handleRuneMessage(
  ctx: RuneApiContext,
  wallet: string,
  msg: RuneMessage,
  extra: { hasNftCharacter: boolean; totalMatches: number; totalHeat: number },
): Promise<{ type: string; data?: any; error?: string }> {
  try {
    switch (msg.type) {
      case 'forge_sigil': {
        const sigil = await handleForgeSigil(ctx, wallet, msg.grade, extra.hasNftCharacter, extra.totalMatches, extra.totalHeat);
        return { type: 'forge_sigil_ok', data: sigil };
      }
      case 'forge_glyph': {
        const glyph = await handleForgeGlyph(ctx, wallet, msg.glyphType, msg.grade, extra.hasNftCharacter);
        return { type: 'forge_glyph_ok', data: glyph };
      }
      case 'equip_sigil': {
        await handleEquipSigil(ctx, wallet, msg.characterId, msg.slotIndex, msg.sigilId);
        return { type: 'equip_sigil_ok' };
      }
      case 'unequip_sigil': {
        await handleUnequipSigil(ctx, wallet, msg.characterId, msg.slotIndex);
        return { type: 'unequip_sigil_ok' };
      }
      case 'equip_glyph': {
        await handleEquipGlyph(ctx, wallet, msg.slotIndex, msg.glyphId);
        return { type: 'equip_glyph_ok' };
      }
      case 'list_sigils': {
        const sigils = await handleListSigils(ctx, wallet);
        return { type: 'list_sigils_ok', data: sigils };
      }
      case 'list_glyphs': {
        const glyphs = await handleListGlyphs(ctx, wallet);
        return { type: 'list_glyphs_ok', data: glyphs };
      }
      case 'mint_sigil': {
        const result = await handleMintSigilNFT(ctx, wallet, msg.sigilId);
        return { type: 'mint_sigil_ok', data: result };
      }
      default:
        return { type: 'error', error: '알 수 없는 룬 메시지' };
    }
  } catch (err: any) {
    return { type: 'error', error: err.message ?? String(err) };
  }
}
