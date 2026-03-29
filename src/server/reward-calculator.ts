/**
 * reward-calculator.ts — 매치 보상 계산기
 *
 * 03-token-acquisition.md v2 기반:
 *   - 전 역할 동일 토큰 ($WATER, $SOIL) + Heat(비거래)
 *   - 역할별 contribution 배율 차등
 *   - 봇 방지 (AI위임율, 최소 시간/기여도, 일일 상한)
 */

import type { Entity } from '../shared/combat-entities.js';

// ─── 타입 ───

export type Role = 'ranged' | 'melee' | 'tank' | 'support';

export interface MatchResult {
  winner: 'A' | 'B';
  scoreA: number;
  scoreB: number;
  durationSec: number;
  entities: readonly MatchEntity[];
}

/** Entity + 보상 계산에 필요한 추가 필드 */
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
  activeTicks: number;   // AI 위임이 아닌 실제 조작 틱
  totalTicks: number;    // 전체 틱
  isHuman: boolean;      // false = 순수 AI (봇 슬롯)
}

export interface PlayerReward {
  entityId: string;
  entityName: string;
  team: 'A' | 'B';
  role: Role;
  contribution: number;
  water: number;
  soil: number;
  heat: number;
  blocked: boolean;      // 봇/최소 기여 미달 시 true
  blockReason?: string;
  aiDelegationRatio?: number;  // AI 위임 비율 (0~1)
  aiMultiplier?: number;       // AI 위임 보상 배율
}

export interface HostReward {
  water: number;
  soil: number;
  heat: number;
  humanCount: number;
  blocked: boolean;
  blockReason?: string;
}

// ─── 상수 ───

/** 매치 완료 기본 보상 */
const BASE_COMPLETE = 5;
const BONUS_WIN = 5;
const BONUS_LONG_MATCH = 3;        // 3분(180초) 이상
const LONG_MATCH_THRESHOLD = 180;

/** contribution → 토큰 변환 계수 */
const WATER_PER_CONTRIB = 0.05;
const SOIL_PER_CONTRIB = 0.03;

/** Heat 고정 보상 */
const HEAT_KILL = 2;
const HEAT_ASSIST = 1;
const HEAT_CAPTURE = 3;
const HEAT_DEFEND = 2;
const HEAT_COMPLETE = 5;
const HEAT_WIN = 3;

/** 봇 방지 임계값 */
const MIN_DURATION_SEC = 60;
const MIN_CONTRIBUTION = 30;

/**
 * AI 위임 단계별 보상 배율 (기존: 80% 이상 → 0)
 * → 변경: 단계별 감소. AI에 맡겨도 보상을 받을 수 있음
 */
const AI_RATIO_TIERS: { maxAiRatio: number; multiplier: number }[] = [
  { maxAiRatio: 0.30, multiplier: 1.00 },  // 0~30% AI: 풀 보상
  { maxAiRatio: 0.60, multiplier: 0.80 },  // 30~60% AI: 80%
  { maxAiRatio: 0.80, multiplier: 0.50 },  // 60~80% AI: 50%
  { maxAiRatio: 0.95, multiplier: 0.25 },  // 80~95% AI: 25%
  { maxAiRatio: 1.00, multiplier: 0.10 },  // 95~100% AI (AFK): 10%
];

/** 매치 품질 배율 (durationSec 기반) */
const QUALITY_SHORT = 0.5;         // < 2분
const QUALITY_NORMAL = 1.0;        // 2~4분
const QUALITY_LONG = 1.2;          // > 4분
const QUALITY_STOMP = 0.8;         // 점수차 > 200

/** 일일 상한 */
export const DAILY_CAP = {
  water: 200,
  soil: 120,
} as const;

/** 서버 운영자(호스트) 보상 */
const HOST_BASE_WATER = 1;
const HOST_BASE_SOIL = 1;
const HOST_PER_HUMAN = 0.5;   // 인간 플레이어 1명당 추가
const HOST_HEAT = 2;

/** 운영자 일일 상한 (일반 유저보다 높음) */
export const HOST_DAILY_CAP = {
  water: 500,
  soil: 300,
} as const;

/** 소수 반올림 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── contribution 계산 ───

/** ULT_CHARGE 가중치 기반 기여도 (03-token-acquisition.md §2.2) */
function baseContribution(e: MatchEntity): number {
  return (e.kills * 30)
       + (e.assists * 15)
       + (e.captures * 20)
       + (e.defends * 10)
       + (e.activeTicks * 0.5)
       - (e.deaths * 20);
}

/** 역할별 배율 보정 (§2.4) */
function roleContribution(e: MatchEntity): number {
  let c = baseContribution(e);

  switch (e.role) {
    case 'tank':
      // 거점 활동 가중: captures +25%, defends +50%
      c += e.captures * (25 - 20);   // 25 - 기본 20 = +5
      c += e.defends * (15 - 10);    // 15 - 기본 10 = +5
      break;
    case 'support':
      // 힐링 + 어시스트 가중
      c += e.healingDone * 0.003;
      c += e.assists * (20 - 15);    // +5
      break;
    case 'ranged':
      // 딜량 가중
      c += e.damageDealt * 0.002;
      break;
    case 'melee':
      // 킬 가중: kills +17%
      c += e.kills * (35 - 30);      // +5
      break;
  }

  return Math.max(0, c);
}

// ─── 매치 품질 ───

function qualityMultiplier(durationSec: number, scoreDiff: number): number {
  let mult = QUALITY_NORMAL;
  if (durationSec < 120) mult = QUALITY_SHORT;
  else if (durationSec > 240) mult = QUALITY_LONG;

  if (scoreDiff > 200) mult *= QUALITY_STOMP;

  return mult;
}

// ─── 메인 함수 ───

/**
 * 매치 종료 시 모든 엔티티의 보상을 계산한다.
 * 서버(game-room.ts)에서 onWin 후 호출.
 */
export function calculateRewards(match: MatchResult): PlayerReward[] {
  const scoreDiff = Math.abs(match.scoreA - match.scoreB);
  const quality = qualityMultiplier(match.durationSec, scoreDiff);

  return match.entities.map(e => {
    // 봇/최소 조건 체크
    const blockResult = checkBlocked(e, match);
    if (blockResult) {
      return zeroReward(e, blockResult);
    }

    const contribution = roleContribution(e);
    if (contribution < MIN_CONTRIBUTION) {
      return zeroReward(e, `contribution ${Math.floor(contribution)} < ${MIN_CONTRIBUTION}`);
    }

    // AI 위임 배율 계산 (단계별 감소)
    const aiMult = getAIDelegationMultiplier(e);

    const isWinner = e.team === match.winner;
    const base = BASE_COMPLETE + (isWinner ? BONUS_WIN : 0)
               + (match.durationSec >= LONG_MATCH_THRESHOLD ? BONUS_LONG_MATCH : 0);

    const water = Math.floor((base + contribution * WATER_PER_CONTRIB) * quality * aiMult);
    const soil = Math.floor((base + contribution * SOIL_PER_CONTRIB) * quality * aiMult);

    const heat = Math.floor(((e.kills * HEAT_KILL)
               + (e.assists * HEAT_ASSIST)
               + (e.captures * HEAT_CAPTURE)
               + (e.defends * HEAT_DEFEND)
               + HEAT_COMPLETE
               + (isWinner ? HEAT_WIN : 0)) * aiMult);

    return {
      entityId: e.id,
      entityName: e.name,
      team: e.team,
      role: e.role,
      contribution: Math.floor(contribution),
      water,
      soil,
      heat,
      blocked: false,
      aiDelegationRatio: e.totalTicks > 0 ? round2(1 - e.activeTicks / e.totalTicks) : 0,
      aiMultiplier: round2(aiMult),
    };
  });
}

/** 서버 운영자(호스트) 보상 계산 */
export function calculateHostReward(match: MatchResult): HostReward {
  const humanCount = match.entities.filter(e => e.isHuman).length;
  if (humanCount === 0 || match.durationSec < MIN_DURATION_SEC) {
    return { water: 0, soil: 0, heat: 0, humanCount, blocked: true, blockReason: humanCount === 0 ? '인간 플레이어 없음' : `매치 시간 부족 (${Math.floor(match.durationSec)}초)` };
  }

  // 기본 보상 + 인간 플레이어 수 보너스
  const water = Math.floor(HOST_BASE_WATER + humanCount * HOST_PER_HUMAN);
  const soil = Math.floor(HOST_BASE_SOIL + humanCount * HOST_PER_HUMAN * 0.6);
  const heat = HOST_HEAT;

  return { water, soil, heat, humanCount, blocked: false };
}

// ─── 헬퍼 ───

function checkBlocked(e: MatchEntity, match: MatchResult): string | null {
  if (!e.isHuman) return 'AI 슬롯 (비인간)';
  if (match.durationSec < MIN_DURATION_SEC) return `매치 시간 ${match.durationSec}초 < ${MIN_DURATION_SEC}초`;
  // AI 위임은 더 이상 차단하지 않음 — 대신 getAIDelegationMultiplier()로 단계별 감소
  return null;
}

/** AI 위임 비율에 따른 보상 배율 (단계별 감소) */
function getAIDelegationMultiplier(e: MatchEntity): number {
  if (e.totalTicks <= 0) return 1.0;
  const aiRatio = 1 - (e.activeTicks / e.totalTicks);

  for (const tier of AI_RATIO_TIERS) {
    if (aiRatio <= tier.maxAiRatio) return tier.multiplier;
  }
  return AI_RATIO_TIERS[AI_RATIO_TIERS.length - 1].multiplier;
}

function zeroReward(e: MatchEntity, reason: string): PlayerReward {
  return {
    entityId: e.id,
    entityName: e.name,
    team: e.team,
    role: e.role,
    contribution: 0,
    water: 0,
    soil: 0,
    heat: 0,
    blocked: true,
    blockReason: reason,
  };
}

// ─── Entity → MatchEntity 변환 (game-room에서 사용) ───

export interface EntityExtras {
  assists: number;
  captures: number;
  defends: number;
  activeTicks: number;
  totalTicks: number;
  isHuman: boolean;
}

/** 게임 엔진의 Entity + 서버 추적 데이터 → MatchEntity */
export function toMatchEntity(e: Entity, extras: EntityExtras): MatchEntity {
  return {
    id: e.id,
    name: e.name,
    team: e.team,
    role: e.role,
    kills: e.kills,
    deaths: e.deaths,
    assists: extras.assists,
    captures: extras.captures,
    defends: extras.defends,
    damageDealt: e.damageDealt,
    healingDone: e.healingDone,
    activeTicks: extras.activeTicks,
    totalTicks: extras.totalTicks,
    isHuman: extras.isHuman,
  };
}
