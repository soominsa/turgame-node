/**
 * reward-calculator.ts — 매치 $SEED 배분 (v5 경제)
 *
 * 03-token-acquisition.md v3 / 01-token-economy.md v5 기반:
 *   - 매치당 200 $SEED 고정 총량
 *   - 승팀 100 / 패팀 해당 점수 / 나머지 노드 운영자
 *   - 팀 내 해시파워 비율 배분 (F2P 1.0, NFT 1.5)
 *   - AI 위임 단계별 감소 (봇 방지)
 */

import type { Entity } from '@shared/combat-entities.js';

// ─── 상수 ───

const MATCH_TOTAL_SEED = 200;
const WINNER_SEED = 100;
const HASHPOWER_FREE = 1.0;
const HASHPOWER_NFT = 1.5;
const MIN_DURATION_SEC = 60;

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

export function calculateRewards(match: MatchResult): { players: PlayerReward[]; host: HostReward } {
  const humanCount = match.entities.filter(e => e.isHuman).length;

  if (match.durationSec < MIN_DURATION_SEC) {
    return {
      players: match.entities.map(e => zeroReward(e, `매치 시간 ${Math.floor(match.durationSec)}초 < ${MIN_DURATION_SEC}초`)),
      host: { seed: 0, humanCount, blocked: true, blockReason: '매치 시간 부족' },
    };
  }

  const loserTeam = match.winner === 'A' ? 'B' : 'A';
  const loserScore = Math.min(loserTeam === 'A' ? match.scoreA : match.scoreB, 90);

  const teamPools: Record<'A' | 'B', number> = {
    [match.winner]: WINNER_SEED,
    [loserTeam]: loserScore,
  } as Record<'A' | 'B', number>;

  const hostSeed = MATCH_TOTAL_SEED - teamPools.A - teamPools.B;

  const players: PlayerReward[] = [];

  for (const team of ['A', 'B'] as const) {
    const members = match.entities.filter(e => e.team === team);
    const pool = teamPools[team];

    const effectiveHP = members.map(e => {
      const baseHP = e.isNft ? HASHPOWER_NFT : HASHPOWER_FREE;
      const aiMult = e.isHuman ? getAIDelegationMultiplier(e) : 0.10;
      return { entity: e, hp: baseHP * aiMult, aiMult };
    });

    const totalHP = effectiveHP.reduce((sum, m) => sum + m.hp, 0);

    for (const m of effectiveHP) {
      const share = totalHP > 0 ? m.hp / totalHP : 0;
      const seed = Math.floor(pool * share);

      players.push({
        entityId: m.entity.id, entityName: m.entity.name,
        team: m.entity.team, role: m.entity.role,
        seed, hashPower: m.entity.isNft ? HASHPOWER_NFT : HASHPOWER_FREE,
        blocked: !m.entity.isHuman,
        blockReason: m.entity.isHuman ? undefined : 'AI 슬롯',
        aiDelegationRatio: m.entity.totalTicks > 0 ? round2(1 - m.entity.activeTicks / m.entity.totalTicks) : 0,
        aiMultiplier: round2(m.aiMult),
      });
    }
  }

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
