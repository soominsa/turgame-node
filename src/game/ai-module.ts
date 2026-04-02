import { Entity } from '../shared/combat-entities.js';
import { getAIDifficultyConfig, type AIDifficultyConfig } from './settings-ui.js';
import { ELEMENT_WEAKNESS, FIRE_DOT_BY_ELEMENT } from './game-engine-types.js';
import type { ElementType } from '../shared/characters/char-sheet.js';

// ─── AI가 필요로 하는 게임 월드 인터페이스 ───

export interface CapturePoint {
  x: number; y: number; radius: number;
  owner: 'A' | 'B' | 'neutral'; progress: number;
  capturingTeam: 'A' | 'B' | null;
}

export interface ResourceTerrainInfo {
  type: string;
  x: number; y: number;
  radius: number;
  boostRadius: number;
  boostTypes: string[];
}

export interface AIWorldContext {
  entities: Entity[];
  points: CapturePoint[];
  terrains: ResourceTerrainInfo[];
  items: Array<{ x: number; y: number; type: string; pickedUp: boolean; lifetime: number }>;
  hazardZones: Array<{ x: number; y: number; radius: number; type: string }>;
  telegraphs: Array<{ x: number; y: number; radius: number; delay: number; owner: Entity; isHeal: boolean }>;
  /** 불타는 타일 좌표 (AI 회피용) */
  burningTiles: Array<{ x: number; y: number }>;
  /** 타일 좌표의 원소 속성 조회 (null=중립) */
  tileElementAt: (x: number, y: number) => ElementType | null;
  /** 필드 크기 */
  fieldW: number;
  fieldH: number;
  time: number;
  // ─── 시야 시스템 ───
  /** 좌표가 해당 팀의 현재 시야 안인지 (fog state=2) */
  isInVision: (team: 'A' | 'B', x: number, y: number) => boolean;
  /** 좌표가 해당 팀에게 탐험된 적 있는지 (fog state>=1) */
  isExplored: (team: 'A' | 'B', x: number, y: number) => boolean;
  /** 미탐험 타일 중 가장 가까운 것 찾기 */
  findNearestUnexplored: (e: Entity) => { x: number; y: number } | null;
  // 유틸 함수 (conquest-scene에서 주입)
  hasLineOfSight: (x1: number, y1: number, x2: number, y2: number) => boolean;
  isWallAt: (x: number, y: number) => boolean;
  findPathBFS: (sx: number, sy: number, tx: number, ty: number) => [number, number][] | null;
  moveToward: (e: Entity, tx: number, ty: number) => void;
  moveAway: (e: Entity, tx: number, ty: number, factor: number) => void;
  autoAttack: (e: Entity, target: Entity) => void;
  autoUseSkills: (e: Entity, target: Entity) => void;
  executeSkill: (user: Entity, skill: Entity['skills'][0], target: Entity) => void;
  findNearestEnemy: (e: Entity) => Entity | null;
  findNearestEnemyIgnoreWalls: (e: Entity) => Entity | null;
  useUltimate: (e: Entity) => void;
}

// ─── AI 전략 ───

export type AIStrategy = 'aggressive' | 'capture' | 'assassin' | 'defensive';

export interface AIState {
  strategy: AIStrategy;
  switchTimer: number;
  wanderAngle: number;
  lockedGoal: { x: number; y: number; until: number } | null;
  lastHp: number; // 타격 감지용
  lastTargetId: string | null; // 타겟 히스테리시스용
  // 시야 기반 탐험 상태
  exploreTarget: { x: number; y: number } | null;  // 현재 탐험 목표
  knownPointCount: number;   // 발견한 거점 수
  knownEnemyCount: number;   // 시야 내 발견한 적 수
  lastExploreTime: number;   // 마지막 탐험 목표 갱신 시각
}

const aiStrategies = new Map<string, AIState>();
// TICK_INTERVAL은 이제 AI 난이도 설정에서 동적으로 가져옴
function getTickInterval(): number { return getAIDifficultyConfig().tickInterval; }

export function clearAIStrategies() {
  aiStrategies.clear();
}

function getAIState(e: Entity): AIState {
  if (!aiStrategies.has(e.id)) {
    const strats: AIStrategy[] = ['aggressive', 'capture', 'assassin', 'defensive'];
    const cfg = getAIDifficultyConfig();
    aiStrategies.set(e.id, {
      strategy: strats[Math.floor(Math.random() * strats.length)],
      switchTimer: cfg.strategySwitchMin + Math.random() * (cfg.strategySwitchMax - cfg.strategySwitchMin),
      wanderAngle: Math.random() * Math.PI * 2,
      lockedGoal: null,
      lastHp: 0,
      lastTargetId: null,
      exploreTarget: null,
      knownPointCount: 0,
      knownEnemyCount: 0,
      lastExploreTime: 0,
    });
  }
  return aiStrategies.get(e.id)!;
}

// ─── 메인 AI 함수 ───

export function runAI(e: Entity, ctx: AIWorldContext) {
  const ai = getAIState(e);
  const cfg = getAIDifficultyConfig();

  // 스킬 선딜/후딜 중에는 행동 불가
  if (e.skillCasting > 0 || e.skillRecovery > 0) return;

  // 실수(멍때림) 확률: 쉬움 모드에서 30% 확률로 아무것도 안 함
  if (cfg.idleChance > 0 && Math.random() < cfg.idleChance) {
    e.vx *= 0.5;
    e.vy *= 0.5;
    return;
  }

  // 궁극기 사용 판단
  if (e.ultReady && !e.dead && e.stunTimer <= 0 && e.ultCasting <= 0) {
    const enemies = ctx.entities.filter(t => t.team !== e.team && !t.dead);
    const nearbyEnemies = enemies.filter(t => {
      const d = Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2);
      return d <= cfg.ultSearchRange;
    });
    // 적 2명 이상 범위 내, 또는 아군 HP 위기 (힐러), 또는 적 거점 점령 직전
    const allyLowHp = ctx.entities.filter(a => a.team === e.team && !a.dead && a.hp < a.maxHp * 0.4).length;
    const shouldUlt = nearbyEnemies.length >= 2
      || (e.role === 'support' && allyLowHp >= 2)
      || (nearbyEnemies.length >= 1 && enemies.length <= 2);
    if (shouldUlt) {
      ctx.useUltimate(e);
      return; // 궁극기 사용 후 턴 종료
    }
  }

  // 위험 구역 회피
  if (ctx.hazardZones && ctx.hazardZones.length > 0) {
    for (const hz of ctx.hazardZones) {
      const dx = e.x - hz.x, dy = e.y - hz.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < hz.radius + 2) {
        // 위험 구역 안에 있음 → 반대 방향으로 도주
        ctx.moveAway(e, hz.x, hz.y, 1.5);
        ai.lockedGoal = null; // 기존 목표 해제
        return;
      }
    }
  }

  // 텔레그래프 회피: 적 AOE 바닥 표시가 자기 위치에 있으면 즉시 이탈
  if (ctx.telegraphs && ctx.telegraphs.length > 0) {
    for (const tg of ctx.telegraphs) {
      if (tg.isHeal && tg.owner.team === e.team) continue; // 아군 힐은 무시
      if (tg.owner.team === e.team) continue; // 아군 텔레그래프는 무시
      const dx = e.x - tg.x, dy = e.y - tg.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < tg.radius + 1) {
        // 텔레그래프 범위 안 → 반대 방향으로 급이탈
        ctx.moveAway(e, tg.x, tg.y, 1.5);
        return;
      }
    }
  }

  // 불 타일 회피: 속성 인식도에 따라 차등 대응
  if (ctx.burningTiles && ctx.burningTiles.length > 0) {
    const fireImmune = cfg.fireAvoidSmart && e.element === 'fire';
    // 불 속성 캐릭터는 불 타일 면역 → 회피 안 함 (보통/어려움만)
    if (!fireImmune) {
      const ex = Math.floor(e.x), ey = Math.floor(e.y);
      // 어려움: 불 DOT가 높은 속성일수록 더 넓은 범위에서 회피
      const fireDot = FIRE_DOT_BY_ELEMENT[e.element] ?? 3;
      const avoidRange = cfg.tileAwareness >= 1.0 ? (fireDot >= 4 ? 2 : 1) : 1;
      for (const bt of ctx.burningTiles) {
        const dx = bt.x - ex, dy = bt.y - ey;
        if (Math.abs(dx) <= avoidRange && Math.abs(dy) <= avoidRange) {
          const urgency = cfg.tileAwareness >= 1.0 ? 1.5 : 1.2;
          ctx.moveAway(e, bt.x + 0.5, bt.y + 0.5, urgency);
          return;
        }
      }
    }
  }

  // 상극 타일 회피 (보통/어려움): 현재 밟고 있는 타일이 약점 속성이면 이탈
  if (cfg.avoidWeaknessTile) {
    const curTileElem = ctx.tileElementAt(Math.floor(e.x), Math.floor(e.y));
    const weakness = ELEMENT_WEAKNESS[e.element];
    if (curTileElem && curTileElem === weakness) {
      // 약점 타일 위에 서있음 → 전투 중이 아닐 때 이탈, 전투 중이면 확률적 이탈
      const inCombat = !!pickTarget(e, ai.strategy, ctx);
      const shouldEvade = !inCombat || (cfg.tileAwareness >= 1.0 ? Math.random() < 0.7 : Math.random() < 0.3);
      if (shouldEvade) {
        const safeTile = findNearestSafeTile(e, ctx, cfg);
        if (safeTile) {
          ctx.moveToward(e, safeTile.x + 0.5, safeTile.y + 0.5);
          return;
        }
      }
    }
  }

  // 아이템 줍기: 가까운 아이템 탐색 (전투 중이어도 경로 위 아이템은 줍기)
  if (ctx.items && ctx.items.length > 0) {
    const hpPct = e.hp / e.maxHp;
    const nearestEnemy = ctx.findNearestEnemy(e);
    const enemyDist = nearestEnemy ? Math.sqrt((nearestEnemy.x - e.x) ** 2 + (nearestEnemy.y - e.y) ** 2) : 999;

    let bestItem = null as { x: number; y: number; dist: number } | null;
    for (const item of ctx.items) {
      if (item.pickedUp || item.lifetime <= 0) continue;
      const dx = item.x - e.x, dy = item.y - e.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > cfg.itemSearchRange) continue; // 난이도별 탐색 범위

      // 점수: 가까울수록 높음, 포션은 HP 낮을 때 보너스
      let score = 12 - d; // 기본: 거리 역비례
      if (item.type === 'health_potion' && hpPct < 0.6) score += 8;
      if (item.type === 'health_potion' && hpPct < 0.3) score += 12; // 빈사 시 포션 최우선
      if (item.type === 'ult_charge' && e.ultCharge < 70) score += 4;
      if (item.type === 'cooldown_elixir') score += 3;

      // 적보다 아이템이 가깝거나, 전투 중이 아니면 줍기
      if (d < enemyDist || enemyDist > 6) {
        if (!bestItem || score > (12 - bestItem.dist)) {
          bestItem = { x: item.x, y: item.y, dist: d };
        }
      }
    }
    if (bestItem) {
      // lockedGoal을 아이템으로 교체
      ai.lockedGoal = { x: bestItem.x, y: bestItem.y, until: ctx.time + 3 };
      ctx.moveToward(e, bestItem.x, bestItem.y);
      return;
    }
  }

  // 전략 전환 타이머
  ai.switchTimer -= getTickInterval();
  if (ai.switchTimer <= 0) {
    const strats: AIStrategy[] = ['aggressive', 'capture', 'assassin', 'defensive'];
    ai.strategy = strats[Math.floor(Math.random() * strats.length)];
    ai.switchTimer = cfg.strategySwitchMin + Math.random() * (cfg.strategySwitchMax - cfg.strategySwitchMin);
    ai.wanderAngle = Math.random() * Math.PI * 2;
  }

  ai.wanderAngle += (Math.random() - 0.5) * 0.3;
  const noiseX = Math.cos(ai.wanderAngle) * 0.15;
  const noiseY = Math.sin(ai.wanderAngle) * 0.15;

  const target = pickTarget(e, ai.strategy, ctx);
  let goalPt = pickCapturePoint(e, ai.strategy, ctx);

  // 목표 해제 조건
  const tookDamage = ai.lastHp > 0 && e.hp < ai.lastHp; // 타격받음
  ai.lastHp = e.hp;

  if (ai.lockedGoal) {
    const distToLocked = Math.sqrt((e.x - ai.lockedGoal.x) ** 2 + (e.y - ai.lockedGoal.y) ** 2);
    const shouldUnlock =
      distToLocked < 2 ||               // 도착
      ctx.time > ai.lockedGoal.until ||  // 타임아웃
      tookDamage ||                      // 타격받음 → 재평가
      (target && !target.dead);          // 시야에 적 발견 → 전투 우선
    if (shouldUnlock) ai.lockedGoal = null;
  }

  // ─── 시야 기반 우선순위 목표 설정 ───
  // 우선순위: 적 발견 > 거점 점령 > 미탐험 탐색 > 랜덤 이동
  // 난이도별: 쉬움은 전지적 시점, 보통/어려움은 시야 제한
  if (!ai.lockedGoal && !target) {
    // 시야 내 발견한 거점/적 상황 업데이트
    const visiblePoints = ctx.points.filter(p => ctx.isInVision(e.team, p.x, p.y) || !cfg.visionAwareGoal);
    const exploredPoints = ctx.points.filter(p => ctx.isExplored(e.team, p.x, p.y) || !cfg.visionAwareGoal);
    ai.knownPointCount = exploredPoints.length;
    ai.knownEnemyCount = ctx.entities.filter(t => t.team !== e.team && !t.dead &&
      Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2) <= e.visionRange).length;

    // 1) 거점이 있으면 거점으로
    if (goalPt && (ctx.isExplored(e.team, goalPt.x, goalPt.y) || !cfg.visionAwareGoal)) {
      ai.lockedGoal = { x: goalPt.x, y: goalPt.y, until: ctx.time + 8 + Math.random() * 5 };
      ai.exploreTarget = null;
    }
    // 2) 거점 없고 탐험 활성화 → 미탐험 지역 탐색
    else if (cfg.visionExplore && !ai.exploreTarget && ctx.time - ai.lastExploreTime > 2) {
      const unexplored = ctx.findNearestUnexplored(e);
      if (unexplored) {
        ai.exploreTarget = unexplored;
        ai.lastExploreTime = ctx.time;
        ai.lockedGoal = { x: unexplored.x + 0.5, y: unexplored.y + 0.5, until: ctx.time + 6 };
      }
    }
    // 3) 탐험 목표가 있으면 계속 이동
    else if (ai.exploreTarget) {
      const eDist = Math.sqrt((e.x - ai.exploreTarget.x) ** 2 + (e.y - ai.exploreTarget.y) ** 2);
      if (eDist < 2 || ctx.isExplored(e.team, ai.exploreTarget.x, ai.exploreTarget.y)) {
        // 도착 또는 이미 탐험됨 → 새 목표
        ai.exploreTarget = null;
        const nextUnexplored = ctx.findNearestUnexplored(e);
        if (nextUnexplored) {
          ai.exploreTarget = nextUnexplored;
          ai.lastExploreTime = ctx.time;
          ai.lockedGoal = { x: nextUnexplored.x + 0.5, y: nextUnexplored.y + 0.5, until: ctx.time + 6 };
        }
      } else {
        ai.lockedGoal = { x: ai.exploreTarget.x + 0.5, y: ai.exploreTarget.y + 0.5, until: ctx.time + 6 };
      }
    }
    // 4) 그 외: 적 방향으로 이동 — 팀 시야 내 적 우선, 없으면 벽 무시 탐색
    else {
      // 팀 시야에 보이는 적 우선 추적 (동료가 밝힌 적)
      const teamVisibleEnemy = ctx.entities
        .filter(t => t.team !== e.team && !t.dead && ctx.isInVision(e.team, t.x, t.y))
        .sort((a, b) => {
          const da = (a.x - e.x) ** 2 + (a.y - e.y) ** 2;
          const db = (b.x - e.x) ** 2 + (b.y - e.y) ** 2;
          return da - db;
        })[0];
      if (teamVisibleEnemy) {
        ai.lockedGoal = { x: teamVisibleEnemy.x, y: teamVisibleEnemy.y, until: ctx.time + 5 };
      } else {
        const anyEnemy = ctx.findNearestEnemyIgnoreWalls(e);
        if (anyEnemy) {
          ai.lockedGoal = { x: anyEnemy.x, y: anyEnemy.y, until: ctx.time + 5 };
        }
      }
    }
  }

  // 역할별 AI 실행
  switch (e.role) {
    case 'ranged':
      runRangedAI(e, ai, target, goalPt, noiseX, noiseY, ctx);
      break;
    case 'melee':
      runMeleeAI(e, ai, target, goalPt, noiseX, noiseY, ctx);
      break;
    case 'tank':
      runTankAI(e, ai, target, goalPt, noiseX, noiseY, ctx);
      break;
    case 'support':
      runSupportAI(e, ai, target, goalPt, noiseX, noiseY, ctx);
      break;
  }

  // 서포터/힐러: 힐+버프 스킬 사용
  if (e.role === 'support') {
    // 자힐 우선
    const selfHurt = e.hp < e.maxHp * 0.6;
    const hurtAlly = selfHurt
      ? e
      : ctx.entities.find(a => a.team === e.team && !a.dead && a.hp < a.maxHp * 0.6) || null;
    if (hurtAlly) {
      const heal = e.skills.find(s => s.type === 'heal' && s.remaining <= 0);
      if (heal) {
        const d = Math.sqrt((hurtAlly.x - e.x) ** 2 + (hurtAlly.y - e.y) ** 2);
        if (d <= heal.range) ctx.executeSkill(e, heal, hurtAlly);
      }
    }
    // 버프 스킬
    const buffSkill = e.skills.find(s => s.type === 'buff' && s.remaining <= 0);
    if (buffSkill) {
      const buffTarget = ctx.entities.find(a =>
        a.team === e.team && !a.dead && a.id !== e.id &&
        !a.buffs.some(b => b.type === 'speed')
      );
      if (buffTarget) {
        const d = Math.sqrt((buffTarget.x - e.x) ** 2 + (buffTarget.y - e.y) ** 2);
        if (d <= buffSkill.range) ctx.executeSkill(e, buffSkill, buffTarget);
      }
    }
  }

  // 공격 + 스킬
  if (target && !target.dead) {
    ctx.autoAttack(e, target);
    if (Math.random() < cfg.skillUseChance) ctx.autoUseSkills(e, target);
    ai.lastTargetId = target.id;
  } else {
    ai.lastTargetId = null;
  }
}

// ─── 타겟 선택 ───

function pickTarget(e: Entity, strategy: AIStrategy, ctx: AIWorldContext): Entity | null {
  const cfg = getAIDifficultyConfig();
  const ai = getAIState(e);

  const visible = ctx.entities.filter(t => {
    if (t.team === e.team || t.dead) return false;
    // 팀 공유 시야 밖 무시 (보통/어려움) — 동료가 밝혔으면 타겟 가능
    if (cfg.visionAwareTarget && !ctx.isInVision(e.team, t.x, t.y)) return false;
    return ctx.hasLineOfSight(e.x, e.y, t.x, t.y);
  });
  if (visible.length === 0) return null;

  // ── 협공 판단: 아군이 이미 공격 중인 적을 우선 타겟 ──
  const allyTargets = new Map<string, number>(); // entityId → 공격하는 아군 수
  for (const ally of ctx.entities) {
    if (ally.team !== e.team || ally.dead || ally.id === e.id) continue;
    // 아군이 교전 중인 적 = 아군 사거리+2 내 가장 가까운 적
    let closestEnemy: Entity | null = null;
    let closestDist = Infinity;
    for (const t of visible) {
      const d = Math.sqrt((ally.x - t.x) ** 2 + (ally.y - t.y) ** 2);
      if (d < ally.attackRange + 2 && d < closestDist) {
        closestDist = d;
        closestEnemy = t;
      }
    }
    if (closestEnemy) {
      allyTargets.set(closestEnemy.id, (allyTargets.get(closestEnemy.id) || 0) + 1);
    }
  }

  // ── 근접 캐릭터는 원거리 적 우선 (카이팅 카운터) ──
  const isMelee = e.attackRange <= 3;

  // 점수 기반 타겟 선택
  let bestTarget: Entity | null = null;
  let bestScore = -Infinity;

  for (const t of visible) {
    const dist = Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2);
    let score = 0;

    // 기본: 가까운 적 선호
    score += (20 - dist) * 2;

    // 타겟 히스테리시스: 현재 타겟에게 보너스 (+15)
    if (t.id === ai.lastTargetId) score += 15;

    // 협공 보너스: 아군이 이미 공격 중인 적 +30
    const allyCount = allyTargets.get(t.id) || 0;
    if (allyCount > 0) score += cfg.coopBonus;

    // 근접→원거리 타겟 보너스: 원거리 적에게 +20
    if (isMelee && t.attackRange > 3) score += 20;

    // 전략별 보너스
    switch (strategy) {
      case 'assassin':
        if (t.role === 'ranged' || t.role === 'support') score += 25;
        if (t.hp / t.maxHp < 0.4) score += 15;
        break;
      case 'aggressive':
        score += (1 - t.hp / t.maxHp) * 30; // 피가 적은 적 선호
        break;
    }

    // 어려움: 디버프 상태인 적 우선 타겟 (약점 타일 위 적)
    if (cfg.tileAwareness >= 0.5) {
      if (t.elemDebuff > 0) score += 15 * cfg.tileAwareness;  // 디버프 상태 적 → 추가 피해 가능
      // 내가 버프 상태면 공격적으로
      if (e.elemBuff > 0) score += 10 * cfg.tileAwareness;
    }

    if (score > bestScore) {
      bestScore = score;
      bestTarget = t;
    }
  }

  return bestTarget;
}

// ─── 거점 선택 ───

function pickCapturePoint(e: Entity, strategy: AIStrategy, ctx: AIWorldContext): CapturePoint | null {
  const cfg = getAIDifficultyConfig();
  // 어려움: 탐험된 거점만 목표로 설정
  const known = cfg.visionAwareGoal
    ? ctx.points.filter(p => ctx.isExplored(e.team, p.x, p.y))
    : ctx.points;
  const unowned = known.filter(p => p.owner !== e.team);
  if (unowned.length === 0) {
    if (known.length === 0) return null; // 아직 거점 미발견
    // 모든 거점이 우리 팀 → 적이 위협하는 거점 방어, 없으면 null (적 탐색으로 전환)
    const enemies = ctx.entities.filter(t => t.team !== e.team && !t.dead);
    // 적이 가장 가까운 거점 = 위협받는 거점
    let threatened: CapturePoint | null = null;
    let threatDist = Infinity;
    for (const pt of known) {
      for (const en of enemies) {
        const d = Math.sqrt((en.x - pt.x) ** 2 + (en.y - pt.y) ** 2);
        if (d < threatDist) {
          threatDist = d;
          threatened = pt;
        }
      }
    }
    // 적이 거점 근처(반경+8)에 있으면 해당 거점 방어
    if (threatened && threatDist < threatened.radius + 8) {
      return threatened;
    }
    // 위협 없음 → null 반환 → AI가 적을 찾으러 감
    return null;
  }

  switch (strategy) {
    case 'capture': {
      return unowned.reduce((a, b) => {
        const aScore = a.owner === 'neutral' ? a.progress : 100 - a.progress;
        const bScore = b.owner === 'neutral' ? b.progress : 100 - b.progress;
        return aScore > bScore ? a : b;
      });
    }
    case 'assassin': {
      const enemyMage = ctx.entities.find(t => t.team !== e.team && (t.role === 'ranged' || t.role === 'support') && !t.dead);
      if (enemyMage) {
        return unowned.reduce((a, b) => {
          const da = Math.sqrt((a.x - enemyMage.x) ** 2 + (a.y - enemyMage.y) ** 2);
          const db = Math.sqrt((b.x - enemyMage.x) ** 2 + (b.y - enemyMage.y) ** 2);
          return da < db ? a : b;
        });
      }
      return unowned[Math.floor(Math.random() * unowned.length)];
    }
    default: {
      if (Math.random() < 0.3) return unowned[Math.floor(Math.random() * unowned.length)];
      const cfg = getAIDifficultyConfig();
      return unowned.reduce((a, b) => {
        let da = Math.sqrt((a.x - e.x) ** 2 + (a.y - e.y) ** 2);
        let db = Math.sqrt((b.x - e.x) ** 2 + (b.y - e.y) ** 2);
        // 어려움: 거점 주변 타일 속성 고려 — 유리한 타일이 많은 거점 선호
        if (cfg.tileAwareness >= 1.0) {
          const scoreA = evaluatePathTileScore(e, a.x, a.y, ctx, cfg);
          const scoreB = evaluatePathTileScore(e, b.x, b.y, ctx, cfg);
          da -= scoreA * 3;  // 유리한 경로의 거점은 가깝게 느끼도록
          db -= scoreB * 3;
        }
        return da < db ? a : b;
      });
    }
  }
}

// ─── 자원 지형 활용 ───

/** 캐릭터 스킬과 매칭되는 유리한 자원 지형 찾기 (+ 속성 타일 고려) */
function findBeneficialTerrain(e: Entity, ctx: AIWorldContext): { x: number; y: number } | null {
  const skillTypes = new Set<string>();
  for (const s of e.skills) {
    skillTypes.add(s.type);
    if (s.fieldEffect) skillTypes.add(s.fieldEffect);
  }

  let best: ResourceTerrainInfo | null = null;
  let bestDist = Infinity;

  for (const t of ctx.terrains) {
    // 이미 범위 안이면 필요없음
    const dist = Math.sqrt((e.x - t.x) ** 2 + (e.y - t.y) ** 2);
    if (dist <= t.boostRadius) return null;

    // 스킬 타입이 매칭되는지 체크
    let matches = false;
    for (const bt of t.boostTypes) {
      if (skillTypes.has(bt)) { matches = true; break; }
    }
    // 이끼밭은 HP 낮을 때 누구나 유리
    if (t.type === 'moss' && e.hp < e.maxHp * 0.6) matches = true;

    if (matches && dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }

  // 너무 멀면 무시 (15u 이상)
  if (!best || bestDist > 15) return null;
  return { x: best.x, y: best.y };
}

// ─── 타일 속성 인식 AI 함수들 ───

/** 가장 가까운 안전 타일 (약점 아닌) 찾기 — BFS 기반 탐색 */
function findNearestSafeTile(e: Entity, ctx: AIWorldContext, cfg: AIDifficultyConfig): { x: number; y: number } | null {
  const weakness = ELEMENT_WEAKNESS[e.element];
  const ex = Math.floor(e.x), ey = Math.floor(e.y);
  const range = Math.max(3, cfg.tileSearchRange);

  let bestDist = Infinity;
  let best: { x: number; y: number } | null = null;

  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const tx = ex + dx, ty = ey + dy;
      if (tx < 0 || ty < 0 || tx >= ctx.fieldW || ty >= ctx.fieldH) continue;
      if (ctx.isWallAt(tx, ty)) continue;
      const tileElem = ctx.tileElementAt(tx, ty);
      // 안전 = 약점 아닌 타일
      if (tileElem === weakness) continue;
      const d = dx * dx + dy * dy;
      if (d < bestDist && d > 0) {
        bestDist = d;
        best = { x: tx, y: ty };
      }
    }
  }
  return best;
}

/** 동일 속성 버프 타일 찾기 — 어려움 AI가 비전투 시 적극 탐색 */
function findBuffTile(e: Entity, ctx: AIWorldContext, cfg: AIDifficultyConfig): { x: number; y: number } | null {
  if (!cfg.seekBuffTile) return null;
  // 이미 버프 상태면 필요 없음
  if (e.elemBuff > 3) return null;

  const ex = Math.floor(e.x), ey = Math.floor(e.y);
  const range = cfg.tileSearchRange;

  let bestDist = Infinity;
  let best: { x: number; y: number } | null = null;

  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const tx = ex + dx, ty = ey + dy;
      if (tx < 0 || ty < 0 || tx >= ctx.fieldW || ty >= ctx.fieldH) continue;
      if (ctx.isWallAt(tx, ty)) continue;
      const tileElem = ctx.tileElementAt(tx, ty);
      if (tileElem === e.element) {
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = { x: tx, y: ty };
        }
      }
    }
  }
  // 너무 멀면 무시 (전투 대비)
  if (!best || bestDist > range * range) return null;
  return best;
}

/**
 * 타일 속성 점수 평가 — 이동 경로 평가 시 사용
 * 양수 = 유리 (동일 속성), 음수 = 불리 (약점 속성), 0 = 중립
 */
function scoreTileElement(e: Entity, tileElem: ElementType | null, cfg: AIDifficultyConfig): number {
  if (!tileElem || cfg.tileAwareness <= 0) return 0;
  if (tileElem === e.element) return 2 * cfg.tileAwareness;         // 동일 속성 → 버프 가능
  const weakness = ELEMENT_WEAKNESS[e.element];
  if (tileElem === weakness) return -3 * cfg.tileAwareness;         // 약점 → 디버프 위험
  return 0;  // 중립 타일
}

/** 두 지점 사이 경로의 타일 속성 평균 점수 (어려움 AI가 이동 결정에 활용) */
function evaluatePathTileScore(e: Entity, tx: number, ty: number, ctx: AIWorldContext, cfg: AIDifficultyConfig): number {
  if (cfg.tileAwareness <= 0) return 0;
  const ex = Math.floor(e.x), ey = Math.floor(e.y);
  const ftx = Math.floor(tx), fty = Math.floor(ty);
  const steps = Math.max(Math.abs(ftx - ex), Math.abs(fty - ey), 1);
  let score = 0;
  const sampleCount = Math.min(steps, 5); // 최대 5개 샘플
  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const sx = Math.floor(ex + (ftx - ex) * t);
    const sy = Math.floor(ey + (fty - ey) * t);
    const elem = ctx.tileElementAt(sx, sy);
    score += scoreTileElement(e, elem, cfg);
  }
  return score / (sampleCount + 1);
}

// ─── 원딜 AI: 거점 위에서 카이팅, 안전 거리 유지하며 딜링 ───

function runRangedAI(e: Entity, ai: AIState, target: Entity | null, goalPt: CapturePoint | null, nx: number, ny: number, ctx: AIWorldContext) {
  const cfg = getAIDifficultyConfig();
  const terrain = findBeneficialTerrain(e, ctx);

  // 히스테리시스 적용
  const distToPoint = goalPt ? Math.sqrt((e.x - goalPt.x) ** 2 + (e.y - goalPt.y) ** 2) : 999;
  const onPoint = goalPt && distToPoint <= goalPt.radius + 0.5;

  if (target && !target.dead) {
    const distT = Math.sqrt((target.x - e.x) ** 2 + (target.y - e.y) ** 2);
    // keepDist에 히스테리시스 적용 (매 틱 랜덤이 아닌 고정값 사용 권장하지만 일단 랜덤 범위 좁힘)
    const kitingFactor = (cfg.kitingPrecisionMin + cfg.kitingPrecisionMax) * 0.5;
    const keepDist = e.attackRange * kitingFactor;

    if (distT < keepDist - 0.5) {
      // 너무 가까우면 후퇴
      if (cfg.tileAwareness >= 1.0) {
        const safeTile = findNearestSafeTile(e, ctx, cfg);
        if (safeTile) {
          const safeAngle = Math.atan2(safeTile.y + 0.5 - e.y, safeTile.x + 0.5 - e.x);
          const awayAngle = Math.atan2(e.y - target.y, e.x - target.x);
          const angleDiff = Math.abs(safeAngle - awayAngle);
          if (angleDiff < Math.PI * 0.7) {
            ctx.moveToward(e, safeTile.x + 0.5, safeTile.y + 0.5);
            return;
          }
        }
      }
      if (onPoint) {
        // 거점 위라면 최대한 거점 안에서 후퇴
        ctx.moveAway(e, target.x, target.y, 0.6);
      } else {
        ctx.moveAway(e, target.x, target.y, 1);
      }
    } else if (distT > e.attackRange + 0.3) {
      ctx.moveToward(e, target.x, target.y);
    } else {
      // 적정 거리 — 어려움: 유리한 타일 위에서 전투 유지
      if (cfg.tileAwareness >= 1.0) {
        const curTile = ctx.tileElementAt(Math.floor(e.x), Math.floor(e.y));
        if (curTile !== e.element) {
          const buffTile = findBuffTile(e, ctx, cfg);
          if (buffTile && Math.sqrt((buffTile.x - e.x) ** 2 + (buffTile.y - e.y) ** 2) < 4) {
            ctx.moveToward(e, buffTile.x + 0.5, buffTile.y + 0.5);
            return;
          }
        }
      }
      // 배회 시 거점 중앙 방향 가중치
      if (onPoint) {
        const toCenterDirX = (goalPt!.x - e.x) / (distToPoint + 0.1);
        const toCenterDirY = (goalPt!.y - e.y) / (distToPoint + 0.1);
        e.vx = (toCenterDirX * 0.3 + nx) * e.speed * 0.2;
        e.vy = (toCenterDirY * 0.3 + ny) * e.speed * 0.2;
      } else {
        ctx.moveAway(e, target.x, target.y, 0.15);
      }
    }
  } else if (ai.lockedGoal || goalPt) {
    const gx = ai.lockedGoal?.x ?? goalPt!.x;
    const gy = ai.lockedGoal?.y ?? goalPt!.y;
    ctx.moveToward(e, gx, gy);
  } else if (cfg.seekBuffTile) {
    // 어려움: 비전투 시 동일 속성 타일로 이동해 버프 충전
    const buffTile = findBuffTile(e, ctx, cfg);
    if (buffTile) {
      ctx.moveToward(e, buffTile.x + 0.5, buffTile.y + 0.5);
    } else if (terrain) {
      ctx.moveToward(e, terrain.x, terrain.y);
    } else {
      const anyEnemy = ctx.findNearestEnemyIgnoreWalls(e);
      if (anyEnemy) ctx.moveToward(e, anyEnemy.x, anyEnemy.y);
    }
  } else if (terrain) {
    ctx.moveToward(e, terrain.x, terrain.y);
  } else {
    const anyEnemy = ctx.findNearestEnemyIgnoreWalls(e);
    if (anyEnemy) ctx.moveToward(e, anyEnemy.x, anyEnemy.y);
  }
}

// ─── 근딜 AI: 적극 교전, 후방 기습, 원딜 우선 처치 ───

function runMeleeAI(e: Entity, ai: AIState, target: Entity | null, goalPt: CapturePoint | null, nx: number, ny: number, ctx: AIWorldContext) {
  const cfg = getAIDifficultyConfig();

  if (target && !target.dead) {
    const distT = Math.sqrt((target.x - e.x) ** 2 + (target.y - e.y) ** 2);

    if (distT > e.attackRange) {
      // 어려움: 적 위치 타일이 나에게 유리한지 평가 → 유리한 경로로 접근
      if (cfg.tileAwareness >= 1.0) {
        const targetTile = ctx.tileElementAt(Math.floor(target.x), Math.floor(target.y));
        const weakness = ELEMENT_WEAKNESS[e.element];
        if (targetTile === weakness && distT < e.attackRange + 4) {
          // 적이 내 약점 타일 위에 있으면 우회하여 접근
          const safeTile = findNearestSafeTile(e, ctx, cfg);
          if (safeTile && Math.sqrt((safeTile.x - target.x) ** 2 + (safeTile.y - target.y) ** 2) < e.attackRange + 2) {
            ctx.moveToward(e, safeTile.x + 0.5, safeTile.y + 0.5);
            return;
          }
        }
      }

      ctx.moveToward(e, target.x, target.y);

      // 갭클로저: 돌진 스킬 선제 사용
      const charge = e.skills.find(s => s.range >= 4 && s.remaining <= 0 && s.damage > 0 && !s.projectileSpeed);
      const chargeRange = charge ? charge.range * 1.2 : 0;
      if (charge && distT <= chargeRange && ctx.hasLineOfSight(e.x, e.y, target.x, target.y) && !e.dashing) {
        e.dashing = true;
        e.dashTarget = { x: target.x, y: target.y };
        e.dashSpeed = 18;
        e.dashDamage = charge.damage;
        e.dashStun = charge.stunDuration;
        e.dashSkillName = charge.name;
        charge.remaining = charge.cooldown;
      }
    } else {
      // 사거리 안: 적 뒤로 돌아가기 시도 (후방 타격 노림)
      if (e.speed >= 5.5 && distT < e.attackRange * 0.8) {
        const behindX = target.x - Math.cos(target.facingAngle) * 1.5;
        const behindY = target.y - Math.sin(target.facingAngle) * 1.5;
        const toBehind = Math.sqrt((behindX - e.x) ** 2 + (behindY - e.y) ** 2);
        if (toBehind > 0.5) {
          ctx.moveToward(e, behindX, behindY);
          return;
        }
      }
      if (ctx.hasLineOfSight(e.x, e.y, target.x, target.y)) {
        e.vx = 0; e.vy = 0;
      } else {
        ctx.moveToward(e, target.x, target.y);
      }
    }
  } else if (ai.lockedGoal || goalPt) {
    const gx = ai.lockedGoal?.x ?? goalPt!.x;
    const gy = ai.lockedGoal?.y ?? goalPt!.y;
    // 어려움: 이동 중 버프 타일 경유
    if (cfg.seekBuffTile && e.elemBuff <= 0) {
      const buffTile = findBuffTile(e, ctx, cfg);
      if (buffTile) {
        const goalDist = Math.sqrt((gx - e.x) ** 2 + (gy - e.y) ** 2);
        const buffDist = Math.sqrt((buffTile.x - e.x) ** 2 + (buffTile.y - e.y) ** 2);
        // 버프 타일이 목적지보다 가까우면 경유
        if (buffDist < goalDist * 0.6) {
          ctx.moveToward(e, buffTile.x + 0.5, buffTile.y + 0.5);
          return;
        }
      }
    }
    ctx.moveToward(e, gx, gy);
  } else {
    // 어려움: 비전투 시 버프 타일 탐색
    if (cfg.seekBuffTile) {
      const buffTile = findBuffTile(e, ctx, cfg);
      if (buffTile) { ctx.moveToward(e, buffTile.x + 0.5, buffTile.y + 0.5); return; }
    }
    const anyEnemy = ctx.findNearestEnemyIgnoreWalls(e);
    if (anyEnemy) ctx.moveToward(e, anyEnemy.x, anyEnemy.y);
    else { e.vx = 0; e.vy = 0; }
  }
}

// ─── 탱커 AI: 거점 사수, 아군 보호, 적극 교전 ───

function runTankAI(e: Entity, ai: AIState, target: Entity | null, goalPt: CapturePoint | null, nx: number, ny: number, ctx: AIWorldContext) {
  const cfg = getAIDifficultyConfig();
  // 탱커는 거점을 우선 — 적이 있어도 거점 위에서 교전
  // 히스테리시스 적용: 0.5유닛 여유
  const distToPoint = goalPt ? Math.sqrt((e.x - goalPt.x) ** 2 + (e.y - goalPt.y) ** 2) : 999;
  const onPoint = goalPt && distToPoint <= goalPt.radius + 0.5;

  if (target && !target.dead) {
    const distT = Math.sqrt((target.x - e.x) ** 2 + (target.y - e.y) ** 2);

    if (distT > e.attackRange) {
      // 거점 위에 있으면 거점에서 벗어나지 않음
      if (onPoint && distT > e.attackRange + 2) {
        // 거점 안에서도 유리한 타일 위치로 미세 조정
        if (cfg.tileAwareness >= 1.0) {
          const curTile = ctx.tileElementAt(Math.floor(e.x), Math.floor(e.y));
          if (curTile !== e.element) {
            const buffTile = findBuffTile(e, ctx, cfg);
            if (buffTile && goalPt && Math.sqrt((buffTile.x - goalPt.x) ** 2 + (buffTile.y - goalPt.y) ** 2) <= goalPt.radius + 1) {
              ctx.moveToward(e, buffTile.x + 0.5, buffTile.y + 0.5);
              return;
            }
          }
        }
        // 그냥 배회하는 대신, 거점 중앙 방향으로 살짝 이동 (중심 유지)
        const toCenterDirX = (goalPt!.x - e.x) / (distToPoint + 0.1);
        const toCenterDirY = (goalPt!.y - e.y) / (distToPoint + 0.1);
        e.vx = (toCenterDirX * 0.4 + nx) * e.speed * 0.3;
        e.vy = (toCenterDirY * 0.4 + ny) * e.speed * 0.3;
      } else {
        ctx.moveToward(e, target.x, target.y);
        // 갭클로저
        const charge = e.skills.find(s => s.range >= 4 && s.remaining <= 0 && s.damage > 0 && !s.projectileSpeed);
        const chargeRange = charge ? charge.range * 1.2 : 0;
        if (charge && distT <= chargeRange && ctx.hasLineOfSight(e.x, e.y, target.x, target.y) && !e.dashing) {
          e.dashing = true;
          e.dashTarget = { x: target.x, y: target.y };
          e.dashSpeed = 18;
          e.dashDamage = charge.damage;
          e.dashStun = charge.stunDuration;
          e.dashSkillName = charge.name;
          charge.remaining = charge.cooldown;
        }
      }
    } else {
      if (ctx.hasLineOfSight(e.x, e.y, target.x, target.y)) {
        e.vx = 0; e.vy = 0;
      } else {
        ctx.moveToward(e, target.x, target.y);
      }
    }
  } else if (ai.lockedGoal || goalPt) {
    const gx = ai.lockedGoal?.x ?? goalPt!.x;
    const gy = ai.lockedGoal?.y ?? goalPt!.y;
    ctx.moveToward(e, gx, gy);
  } else {
    // 어려움: 비전투 시 버프 타일에서 대기
    if (cfg.seekBuffTile) {
      const buffTile = findBuffTile(e, ctx, cfg);
      if (buffTile) { ctx.moveToward(e, buffTile.x + 0.5, buffTile.y + 0.5); return; }
    }
    const anyEnemy = ctx.findNearestEnemyIgnoreWalls(e);
    if (anyEnemy) ctx.moveToward(e, anyEnemy.x, anyEnemy.y);
    else {
      // 제자리에서 배회 (노이즈)
      e.vx = nx * e.speed * 0.2;
      e.vy = ny * e.speed * 0.2;
    }
  }
}

// ─── 서포터 AI: 거점 근처에서 아군 지원 + 자기도 공격 ───

function runSupportAI(e: Entity, ai: AIState, target: Entity | null, goalPt: CapturePoint | null, nx: number, ny: number, ctx: AIWorldContext) {
  const cfg = getAIDifficultyConfig();
  // 가장 가까운 아군 딜러/탱커 찾기
  const allies = ctx.entities.filter(a => a.team === e.team && !a.dead && a.id !== e.id);
  const nearestAlly = allies.length > 0
    ? allies.reduce((a, b) => {
        const da = Math.sqrt((a.x - e.x) ** 2 + (a.y - e.y) ** 2);
        const db = Math.sqrt((b.x - e.x) ** 2 + (b.y - e.y) ** 2);
        return da < db ? a : b;
      })
    : null;

  const followDist = 4;

  if (nearestAlly) {
    const allyDist = Math.sqrt((nearestAlly.x - e.x) ** 2 + (nearestAlly.y - e.y) ** 2);

    if (allyDist > followDist + 3) {
      // 아군이 너무 멀면 따라가기
      ctx.moveToward(e, nearestAlly.x + nx * 2, nearestAlly.y + ny * 2);
    } else if (target && !target.dead) {
      const distT = Math.sqrt((target.x - e.x) ** 2 + (target.y - e.y) ** 2);
      if (distT > e.attackRange) {
        ctx.moveToward(e, target.x, target.y);
      } else if (distT < e.attackRange * 0.3) {
        // 어려움: 후퇴 시 유리한 타일 방향으로
        if (cfg.tileAwareness >= 1.0) {
          const safeTile = findNearestSafeTile(e, ctx, cfg);
          if (safeTile && Math.sqrt((safeTile.x - e.x) ** 2 + (safeTile.y - e.y) ** 2) < 4) {
            ctx.moveToward(e, safeTile.x + 0.5, safeTile.y + 0.5);
            return;
          }
        }
        ctx.moveAway(e, target.x, target.y, 0.6);
      } else {
        // 적정 거리 유지하며 딜링 — 어려움: 버프 타일 위에서 전투
        if (cfg.tileAwareness >= 1.0) {
          const curTile = ctx.tileElementAt(Math.floor(e.x), Math.floor(e.y));
          if (curTile !== e.element) {
            const buffTile = findBuffTile(e, ctx, cfg);
            if (buffTile && Math.sqrt((buffTile.x - e.x) ** 2 + (buffTile.y - e.y) ** 2) < 3) {
              ctx.moveToward(e, buffTile.x + 0.5, buffTile.y + 0.5);
              return;
            }
          }
        }
        e.vx = nx * e.speed * 0.3;
        e.vy = ny * e.speed * 0.3;
      }
    } else if (ai.lockedGoal || goalPt) {
      // 비전투시 거점으로 이동
      const gx = ai.lockedGoal?.x ?? goalPt!.x;
      const gy = ai.lockedGoal?.y ?? goalPt!.y;
      ctx.moveToward(e, gx, gy);
    } else {
      // 어려움: 아군 주변 버프 타일에서 대기
      if (cfg.seekBuffTile) {
        const buffTile = findBuffTile(e, ctx, cfg);
        if (buffTile && Math.sqrt((buffTile.x - nearestAlly.x) ** 2 + (buffTile.y - nearestAlly.y) ** 2) < followDist + 2) {
          ctx.moveToward(e, buffTile.x + 0.5, buffTile.y + 0.5);
          return;
        }
      }
      e.vx = nx * e.speed * 0.3;
      e.vy = ny * e.speed * 0.3;
    }
  } else {
    // 아군 없으면 거점으로
    if (ai.lockedGoal || goalPt) {
      const gx = ai.lockedGoal?.x ?? goalPt!.x;
      const gy = ai.lockedGoal?.y ?? goalPt!.y;
      ctx.moveToward(e, gx, gy);
    }
  }
}
