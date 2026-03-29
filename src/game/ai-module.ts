import { Entity } from '../shared/combat-entities.js';
import { getAIDifficultyConfig, type AIDifficultyConfig } from './settings-ui.js';

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
  time: number;
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

  // 불 타일 회피: 현재 서있는 곳 또는 바로 옆이 불타고 있으면 이탈
  if (ctx.burningTiles && ctx.burningTiles.length > 0) {
    const ex = Math.floor(e.x), ey = Math.floor(e.y);
    for (const bt of ctx.burningTiles) {
      const dx = bt.x - ex, dy = bt.y - ey;
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
        // 불 타일 위에 있거나 바로 인접 → 반대 방향으로 이탈
        ctx.moveAway(e, bt.x + 0.5, bt.y + 0.5, 1.2);
        return;
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

  // 새 목표 설정 (전투 중이면 목표 안 잡음 — 전투 로직이 처리)
  if (!ai.lockedGoal && !target) {
    if (goalPt) {
      ai.lockedGoal = { x: goalPt.x, y: goalPt.y, until: ctx.time + 8 + Math.random() * 5 };
    } else {
      const anyEnemy = ctx.findNearestEnemyIgnoreWalls(e);
      if (anyEnemy) {
        ai.lockedGoal = { x: anyEnemy.x, y: anyEnemy.y, until: ctx.time + 3 };
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
  }
}

// ─── 타겟 선택 ───

function pickTarget(e: Entity, strategy: AIStrategy, ctx: AIWorldContext): Entity | null {
  const visible = ctx.entities.filter(t => t.team !== e.team && !t.dead && ctx.hasLineOfSight(e.x, e.y, t.x, t.y));
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

    // 협공 보너스: 아군이 이미 공격 중인 적 +30
    const allyCount = allyTargets.get(t.id) || 0;
    if (allyCount > 0) score += getAIDifficultyConfig().coopBonus;

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

    if (score > bestScore) {
      bestScore = score;
      bestTarget = t;
    }
  }

  return bestTarget;
}

// ─── 거점 선택 ───

function pickCapturePoint(e: Entity, strategy: AIStrategy, ctx: AIWorldContext): CapturePoint | null {
  const unowned = ctx.points.filter(p => p.owner !== e.team);
  if (unowned.length === 0) {
    // 모든 거점이 우리 팀 → 적이 빼앗을 수 있는 거점 방어 또는 중앙 순찰
    const byDist = ctx.points.sort((a, b) => {
      const da = (a.x - e.x) ** 2 + (a.y - e.y) ** 2;
      const db = (b.x - e.x) ** 2 + (b.y - e.y) ** 2;
      return da - db;
    });
    // 가장 가까운 거점이 아닌 다른 거점으로 이동 (순찰)
    return byDist.length > 1 ? byDist[1] : byDist[0] || null;
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
      return unowned.reduce((a, b) => {
        const da = Math.sqrt((a.x - e.x) ** 2 + (a.y - e.y) ** 2);
        const db = Math.sqrt((b.x - e.x) ** 2 + (b.y - e.y) ** 2);
        return da < db ? a : b;
      });
    }
  }
}

// ─── 자원 지형 활용 ───

/** 캐릭터 스킬과 매칭되는 유리한 자원 지형 찾기 */
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

// ─── 원딜 AI: 거점 위에서 카이팅, 안전 거리 유지하며 딜링 ───

function runRangedAI(e: Entity, ai: AIState, target: Entity | null, goalPt: CapturePoint | null, nx: number, ny: number, ctx: AIWorldContext) {
  const terrain = findBeneficialTerrain(e, ctx);

  if (target && !target.dead) {
    const distT = Math.sqrt((target.x - e.x) ** 2 + (target.y - e.y) ** 2);
    const kiteCfg = getAIDifficultyConfig();
    const keepDist = e.attackRange * (kiteCfg.kitingPrecisionMin + Math.random() * (kiteCfg.kitingPrecisionMax - kiteCfg.kitingPrecisionMin));

    if (distT < keepDist) {
      // 너무 가까우면 후퇴 (거점 방향으로 후퇴 시도)
      if (goalPt) {
        const ptDist = Math.sqrt((goalPt.x - e.x) ** 2 + (goalPt.y - e.y) ** 2);
        if (ptDist < goalPt.radius + 3) {
          ctx.moveAway(e, target.x, target.y, 0.8);
          return;
        }
      }
      ctx.moveAway(e, target.x, target.y, 1);
    } else if (distT > e.attackRange) {
      ctx.moveToward(e, target.x, target.y);
    } else {
      // 적정 거리 — 약간 움직이며 딜링
      ctx.moveAway(e, target.x, target.y, 0.15);
    }
  } else if (ai.lockedGoal || goalPt) {
    const gx = ai.lockedGoal?.x ?? goalPt!.x;
    const gy = ai.lockedGoal?.y ?? goalPt!.y;
    ctx.moveToward(e, gx, gy);
  } else if (terrain) {
    ctx.moveToward(e, terrain.x, terrain.y);
  } else {
    const anyEnemy = ctx.findNearestEnemyIgnoreWalls(e);
    if (anyEnemy) ctx.moveToward(e, anyEnemy.x, anyEnemy.y);
  }
}

// ─── 근딜 AI: 적극 교전, 후방 기습, 원딜 우선 처치 ───

function runMeleeAI(e: Entity, ai: AIState, target: Entity | null, goalPt: CapturePoint | null, nx: number, ny: number, ctx: AIWorldContext) {
  if (target && !target.dead) {
    const distT = Math.sqrt((target.x - e.x) ** 2 + (target.y - e.y) ** 2);

    if (distT > e.attackRange) {
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
    ctx.moveToward(e, gx, gy);
  } else {
    const anyEnemy = ctx.findNearestEnemyIgnoreWalls(e);
    if (anyEnemy) ctx.moveToward(e, anyEnemy.x, anyEnemy.y);
    else { e.vx = 0; e.vy = 0; }
  }
}

// ─── 탱커 AI: 거점 사수, 아군 보호, 적극 교전 ───

function runTankAI(e: Entity, ai: AIState, target: Entity | null, goalPt: CapturePoint | null, nx: number, ny: number, ctx: AIWorldContext) {
  // 탱커는 거점을 우선 — 적이 있어도 거점 위에서 교전
  const onPoint = goalPt && Math.sqrt((e.x - goalPt.x) ** 2 + (e.y - goalPt.y) ** 2) <= goalPt.radius;

  if (target && !target.dead) {
    const distT = Math.sqrt((target.x - e.x) ** 2 + (target.y - e.y) ** 2);

    if (distT > e.attackRange) {
      // 거점 위에 있으면 거점에서 벗어나지 않음
      if (onPoint && distT > e.attackRange + 2) {
        e.vx = nx * e.speed * 0.2;
        e.vy = ny * e.speed * 0.2;
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
    const anyEnemy = ctx.findNearestEnemyIgnoreWalls(e);
    if (anyEnemy) ctx.moveToward(e, anyEnemy.x, anyEnemy.y);
    else { e.vx = 0; e.vy = 0; }
  }
}

// ─── 서포터 AI: 거점 근처에서 아군 지원 + 자기도 공격 ───

function runSupportAI(e: Entity, ai: AIState, target: Entity | null, goalPt: CapturePoint | null, nx: number, ny: number, ctx: AIWorldContext) {
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
        ctx.moveAway(e, target.x, target.y, 0.6);
      } else {
        // 적정 거리 유지하며 딜링
        e.vx = nx * e.speed * 0.3;
        e.vy = ny * e.speed * 0.3;
      }
    } else if (ai.lockedGoal || goalPt) {
      // 비전투시 거점으로 이동
      const gx = ai.lockedGoal?.x ?? goalPt!.x;
      const gy = ai.lockedGoal?.y ?? goalPt!.y;
      ctx.moveToward(e, gx, gy);
    } else {
      // 아군 주변 대기
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
