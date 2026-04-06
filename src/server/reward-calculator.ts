/**
 * reward-calculator.ts — 매치 $SEED 배분 (v5 경제)
 *
 * 03-token-acquisition.md v3 / 01-token-economy.md v5 기반:
 *   - 매치당 200 $SEED 고정 총량
 *   - 승팀 100 / 패팀 해당 점수 / 나머지 노드 운영자
 *   - 팀 내 해시파워 비율 배분 (F2P 1.0, NFT 1.5)
 *   - AI 위임 단계별 감소 (봇 방지)
 *
 * 멀티플레이어 보너스 (승패 동일 배율):
 *   - 1인당: 솔로 25 < 듀오 35 < 트리오 40 < 풀팟 50
 *   - 승팀: 100 × 배율 × 1.0
 *   - 패팀: 100 × 배율 × (점수/100)
 *   - 노드 운영자: 200 - 100 - min(패팀점수, 90) (점수 차이로만, 인원 무관)
 *   - AI 슬롯 몫은 소멸
 */

import type { Entity } from '@shared/combat-entities.js';

// ─── 상수 ───

/** 매치당 총 $SEED */
const MATCH_TOTAL_SEED = 200;

/** 승팀 고정 $SEED */
const WINNER_SEED = 100;

/** 해시파워 (캐릭터 티어별) */
const HASHPOWER_FREE = 1.0;
const HASHPOWER_NFT = 1.5;

/** 인간 수 기반 팀풀 배율 (멀티플레이 보너스) */
const HUMAN_COUNT_MULTIPLIER: Record<number, number> = {
  0: 0.00,   // 인간 없음 → 보상 없음
  1: 0.25,   // 솔로: 100 × 0.25 = 25/인
  2: 0.70,   // 듀오: 100 × 0.70 / 2 = 35/인
  3: 1.20,   // 트리오: 100 × 1.20 / 3 = 40/인
  4: 2.00,   // 풀팟: 100 × 2.00 / 4 = 50/인
};

/** 봇 방지 */
const MIN_DURATION_SEC = 60;

/** AI 위임 단계별 배율 */
const AI_RATIO_TIERS: { maxAiRatio: number; multiplier: number }[] = [
  { maxAiRatio: 0.30, multiplier: 1.00 },
  { maxAiRatio: 0.60, multiplier: 0.80 },
  { maxAiRatio: 0.80, multiplier: 0.50 },
  { maxAiRatio: 0.95, multiplier: 0.25 },
  { maxAiRatio: 1.00, multiplier: 0.10 },
];

// ─── 타입 ───

export type Role = 'ranged' | 'melee' | 'tank' | 'support';

export interface MatchResult {
  winner: 'A' | 'B';
  scoreA: number;
  scoreB: number;
  durationSec: number;
  entities: readonly MatchEntity[];
}

export interface MatchEntity {
  id: string;
  name: string;
  team: 'A' | 'B';
  role: Role;
  kills: number;
  deaths: number;
  assists: number;
  captures: number;
  defends: number;
  damageDealt: number;
  healingDone: number;
  activeTicks: number;
  totalTicks: number;
  isHuman: boolean;
  /** NFT 캐릭터 여부 (해시파워 결정) */
  isNft: boolean;
  element?: string;
}

export interface PlayerReward {
  entityId: string;
  entityName: string;
  team: 'A' | 'B';
  role: Role;
  seed: number;
  hashPower: number;
  blocked: boolean;
  blockReason?: string;
  aiDelegationRatio?: number;
  aiMultiplier?: number;
}

export interface HostReward {
  seed: number;
  humanCount: number;
  blocked: boolean;
  blockReason?: string;
}

// ─── 메인 함수 ───

/**
 * v5 매치 보상 계산 (멀티플레이어 보너스 포함).
 *
 * 총량 200 $SEED:
 *   승팀 = 100 × 인간수 배율 × 1.0 (인간만 해시파워 배분)
 *   패팀 = 100 × 인간수 배율 × (점수/100) (인간만 해시파워 배분)
 *   노드 = 200 - 100 - min(패팀점수, 90) (점수 차이만, 인원 무관)
 */
export function calculateRewards(match: MatchResult): { players: PlayerReward[]; host: HostReward } {
  const humanCount = match.entities.filter(e => e.isHuman).length;

  // 최소 시간 미달
  if (match.durationSec < MIN_DURATION_SEC) {
    return {
      players: match.entities.map(e => zeroReward(e, `매치 시간 ${Math.floor(match.durationSec)}초 < ${MIN_DURATION_SEC}초`)),
      host: { seed: 0, humanCount, blocked: true, blockReason: '매치 시간 부족' },
    };
  }

  // 팀별 기본 $SEED 풀
  const loserTeam = match.winner === 'A' ? 'B' : 'A';
  const loserScore = Math.min(loserTeam === 'A' ? match.scoreA : match.scoreB, 90);

  const baseTeamPools: Record<'A' | 'B', number> = {
    [match.winner]: WINNER_SEED,
    [loserTeam]: loserScore,
  } as Record<'A' | 'B', number>;

  // 팀 내 해시파워 배분 + 멀티플레이어 보너스
  const players: PlayerReward[] = [];
  let totalPlayerSeed = 0;

  for (const team of ['A', 'B'] as const) {
    const members = match.entities.filter(e => e.team === team);
    const basePool = baseTeamPools[team];

    // 인간 수 기반 배율 (승패 동일) × 점수 비례
    // 승팀: 100 × mult (점수=100%), 패팀: 100 × mult × (score/100)
    const teamHumanCount = members.filter(e => e.isHuman).length;
    const humanMult = HUMAN_COUNT_MULTIPLIER[teamHumanCount] ?? 0;
    const scoreRatio = team === match.winner ? 1.0 : loserScore / WINNER_SEED;
    const adjustedPool = Math.floor(WINNER_SEED * humanMult * scoreRatio);

    // 인간만 배분 대상 (AI 슬롯은 blocked, 시드 증발 없음)
    const humans = members.filter(e => e.isHuman);
    const ais = members.filter(e => !e.isHuman);

    // 인간 멤버의 유효 해시파워 (AI 위임 적용)
    const effectiveHP: { entity: MatchEntity; hp: number; aiMult: number }[] = humans.map(e => {
      const baseHP = e.isNft ? HASHPOWER_NFT : HASHPOWER_FREE;
      const aiMult = getAIDelegationMultiplier(e);
      return { entity: e, hp: baseHP * aiMult, aiMult };
    });

    const totalHP = effectiveHP.reduce((sum, m) => sum + m.hp, 0);

    // 인간 플레이어에게 보정된 풀 배분
    for (const m of effectiveHP) {
      const share = totalHP > 0 ? m.hp / totalHP : 0;
      const seed = Math.floor(adjustedPool * share);
      totalPlayerSeed += seed;

      players.push({
        entityId: m.entity.id,
        entityName: m.entity.name,
        team: m.entity.team,
        role: m.entity.role,
        seed,
        hashPower: m.entity.isNft ? HASHPOWER_NFT : HASHPOWER_FREE,
        blocked: false,
        aiDelegationRatio: m.entity.totalTicks > 0 ? round2(1 - m.entity.activeTicks / m.entity.totalTicks) : 0,
        aiMultiplier: round2(m.aiMult),
      });
    }

    // AI 슬롯은 0 시드 + blocked
    for (const e of ais) {
      players.push({
        entityId: e.id,
        entityName: e.name,
        team: e.team,
        role: e.role,
        seed: 0,
        hashPower: e.isNft ? HASHPOWER_NFT : HASHPOWER_FREE,
        blocked: true,
        blockReason: 'AI 슬롯',
      });
    }
  }

  // 노드 운영자: 점수 차이로만 결정 (인원수/배율 무관)
  // 100:60 → 40, 100:90 → 10 (+ WATER/SOIL 부산물 별도)
  const hostSeed = MATCH_TOTAL_SEED - WINNER_SEED - loserScore;

  return {
    players,
    host: {
      seed: Math.max(0, hostSeed),
      humanCount,
      blocked: humanCount === 0,
      blockReason: humanCount === 0 ? '인간 플레이어 없음' : undefined,
    },
  };
}

// ─── 헬퍼 ───

function getAIDelegationMultiplier(e: MatchEntity): number {
  if (e.totalTicks <= 0) return 1.0;
  const aiRatio = 1 - (e.activeTicks / e.totalTicks);
  for (const tier of AI_RATIO_TIERS) {
    if (aiRatio <= tier.maxAiRatio) return tier.multiplier;
  }
  return AI_RATIO_TIERS[AI_RATIO_TIERS.length - 1].multiplier;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function zeroReward(e: MatchEntity, reason: string): PlayerReward {
  return {
    entityId: e.id, entityName: e.name, team: e.team, role: e.role,
    seed: 0, hashPower: e.isNft ? HASHPOWER_NFT : HASHPOWER_FREE,
    blocked: true, blockReason: reason,
  };
}

// ─── Entity → MatchEntity 변환 ───

export interface EntityExtras {
  assists: number;
  captures: number;
  defends: number;
  activeTicks: number;
  totalTicks: number;
  isHuman: boolean;
  isNft: boolean;
}

export function toMatchEntity(e: Entity, extras: EntityExtras): MatchEntity {
  return {
    id: e.id, name: e.name, team: e.team, role: e.role,
    kills: e.kills, deaths: e.deaths,
    assists: extras.assists, captures: extras.captures, defends: extras.defends,
    damageDealt: e.damageDealt, healingDone: e.healingDone,
    activeTicks: extras.activeTicks, totalTicks: extras.totalTicks,
    isHuman: extras.isHuman, isNft: extras.isNft,
    element: e.element,
  };
}
