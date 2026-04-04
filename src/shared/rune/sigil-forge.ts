/**
 * sigil-forge.ts — 시길 제작 (랜덤 롤링)
 *
 * 입력: wallet, grade, 재료 보유량, serverNonce
 * 처리: 자격 확인 → 비용 차감 → 시드 생성 → 원소/능력치/고유효과 롤링
 * 출력: Sigil 객체 (DB 저장은 호출자가 처리)
 */

import {
  type Sigil, type SigilGrade, type SigilElement, type SigilStatKey,
  type SigilSecondary, type UniqueEffectId, type CraftCost,
  SIGIL_STAT_POOL, GRADE_RULES, UNIQUE_EFFECTS, SIGIL_CRAFT_COST,
} from './sigil-types';

// ── 재료 잔고 ──

export interface MaterialBalance {
  wood: number;
  soil: number;
}

// ── 제작 입력 ──

export interface ForgeSigilInput {
  wallet: string;
  grade: SigilGrade;
  materials: MaterialBalance;
  serverNonce: string;
  /** Legendary 제작에 필요한 NFT 캐릭터 보유 여부 */
  hasNftCharacter: boolean;
  /** 총 매치 수 (시드 재료) */
  totalMatches: number;
  /** 총 $SEED 획득량 (시드 재료) */
  totalSeed: number;
}

export interface ForgeSigilResult {
  sigil: Sigil;
  /** 차감된 비용 */
  cost: CraftCost;
}

// ── 해시 기반 시드 생성 ──

function simpleHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** 시드 기반 0~1 난수 생성기 (xorshift32) */
function createRng(seed: number) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xFFFFFFFF;
  };
}

// ── 원소 결정 (v5: RNG 기반, 4원소 균등) ──

const ELEMENTS: SigilElement[] = ['fire', 'water', 'earth', 'nature'];

function determineElement(rng: () => number): SigilElement {
  return ELEMENTS[Math.floor(rng() * ELEMENTS.length)];
}

// ── 스탯 키 목록 ──

const ALL_STAT_KEYS = Object.keys(SIGIL_STAT_POOL) as SigilStatKey[];

// ── 메인 제작 함수 ──

export function forgeSigil(input: ForgeSigilInput): ForgeSigilResult {
  const { wallet, grade, materials, serverNonce, hasNftCharacter, totalMatches, totalSeed } = input;

  // 1. 제작 자격 확인
  if (grade === 'Legendary' && !hasNftCharacter) {
    throw new Error('Legendary 시길은 NFT 캐릭터 보유자만 제작 가능');
  }

  // 2. 비용 확인
  const cost = SIGIL_CRAFT_COST[grade];
  if (materials.wood < cost.wood || materials.soil < cost.soil) {
    throw new Error('재료 부족');
  }

  // 3. 랜덤 시드 생성
  const seedStr = `${wallet}:${Date.now()}:${totalMatches}:${totalSeed}:${serverNonce}`;
  const seed = simpleHash(seedStr);
  const rng = createRng(seed);

  // 4. 원소 결정 (v5: RNG 기반)
  const element = determineElement(rng);

  // 5. 등급 규칙
  const rule = GRADE_RULES[grade];

  // 6. 주 능력치 롤링
  const primaryStatIdx = Math.floor(rng() * ALL_STAT_KEYS.length);
  const primaryStat = ALL_STAT_KEYS[primaryStatIdx];
  const pool = SIGIL_STAT_POOL[primaryStat];
  const range = pool.max - pool.min;
  const [pLow, pHigh] = rule.primaryRange;
  const primaryValue = Math.round(pool.min + range * (pLow + rng() * (pHigh - pLow)));

  // 7. 부 능력치 롤링 (주 능력치와 중복 불가)
  const secondaries: SigilSecondary[] = [];
  const usedStats = new Set<SigilStatKey>([primaryStat]);

  for (let i = 0; i < rule.secondaryCount; i++) {
    const available = ALL_STAT_KEYS.filter(k => !usedStats.has(k));
    if (available.length === 0) break;
    const idx = Math.floor(rng() * available.length);
    const stat = available[idx];
    usedStats.add(stat);

    const sPool = SIGIL_STAT_POOL[stat];
    const sRange = sPool.max - sPool.min;
    const [sLow, sHigh] = rule.secondaryRange;
    const value = Math.round(sPool.min + sRange * (sLow + rng() * (sHigh - sLow)));
    secondaries.push({ stat, value });
  }

  // 8. 고유 효과 롤링 (Legendary, 원소 매칭)
  let uniqueEffect: UniqueEffectId | undefined;
  if (rule.hasUniqueEffect) {
    const candidates = (Object.entries(UNIQUE_EFFECTS) as [UniqueEffectId, { element: SigilElement }][])
      .filter(([, v]) => v.element === element);
    if (candidates.length > 0) {
      const idx = Math.floor(rng() * candidates.length);
      uniqueEffect = candidates[idx][0];
    } else {
      // 원소 매칭 없으면 전체에서 랜덤
      const allKeys = Object.keys(UNIQUE_EFFECTS) as UniqueEffectId[];
      uniqueEffect = allKeys[Math.floor(rng() * allKeys.length)];
    }
  }

  const sigil: Sigil = {
    id: 0, // DB에서 할당
    ownerWallet: wallet,
    grade,
    element,
    primaryStat,
    primaryValue,
    secondaries,
    uniqueEffect,
    fortemStatus: 'LOCAL',
    createdAt: new Date().toISOString(),
  };

  return { sigil, cost };
}
