/**
 * 캐릭터 자동 로딩 인덱스
 *
 * 새 캐릭터 추가 방법:
 *   1. characters/ 폴더에 새 .ts 파일 생성 (예: phoenix.ts)
 *   2. CharSheet 형식에 맞춰 작성, default export
 *   3. 아래 SHEETS 배열에 import 추가
 *   → ALL_CHARS, ULTIMATES 자동 생성
 *
 * TODO: 런타임에는 Vite의 import.meta.glob 또는 fs.readdirSync로
 *       완전 자동화 가능하지만, 현재는 명시적 import으로 안정성 확보
 */

import type { CharSheet, SkillSheet, PassiveSheet } from './char-sheet.js';
import type { Entity, Skill } from '../combat-entities.js';

// ─── 캐릭터 시트 등록 (파일 추가 시 여기에 한 줄 추가) ───

import terra from './terra.js';
import sylvan from './sylvan.js';
import grove from './grove.js';
import breaker from './breaker.js';
import lumina from './lumina.js';
import aeris from './aeris.js';
import stone from './stone.js';
import tide from './tide.js';
import volt from './volt.js';
import blaze from './blaze.js';
import thorn from './thorn.js';
import frost from './frost.js';

export const SHEETS: CharSheet[] = [
  // 원딜 (ranged)
  sylvan, breaker, volt,
  // 근딜 (melee)
  lumina, blaze, thorn,
  // 탱커 (tank)
  terra, stone, frost,
  // 서포터 (support)
  grove, aeris, tide,
];

// ─── CharSheet → Entity 변환 ───

function skillFromSheet(s: SkillSheet): Skill {
  return {
    name: s.name,
    type: s.type,
    cooldown: s.cooldown,
    remaining: s.initialCooldown,
    damage: s.damage,
    range: s.range,
    stunDuration: s.stunDuration,
    aoe: s.aoe,
    fieldEffect: s.fieldEffect,
    projectileSpeed: s.projectileSpeed,
    tracking: s.tracking,
    telegraphDelay: s.telegraphDelay,
    attackAngle: s.attackAngle,
    windupTime: s.windupTime,
    recoveryTime: s.recoveryTime,
    buffEffects: s.buffEffects,
    // 새 필드들
    dot: s.dot,
    slow: s.slow,
    root: s.root,
    knockup: s.knockup,
    shock: s.shock,
    blind: s.blind,
    freeze: s.freeze,
    trap: s.trap,
    teleport: s.teleport,
    summon: s.summon,
    consumeField: s.consumeField,
    vfx: s.vfx,
  };
}

export function createEntity(sheet: CharSheet, team: 'A' | 'B', x: number, y: number): Entity {
  return {
    id: `${sheet.id}_${team}`,
    name: sheet.name,
    team,
    role: sheet.combatRole,
    element: sheet.element,
    x, y, vx: 0, vy: 0,
    speed: sheet.speed,
    hp: sheet.hp,
    maxHp: sheet.hp,
    attackDamage: sheet.attackDamage,
    attackSpeed: sheet.attackSpeed,
    attackRange: sheet.attackRange,
    attackCooldown: 0,
    visionRange: sheet.visionRange ?? 6,
    color: team === 'A' ? sheet.color : sheet.colorAlt,
    size: sheet.size,
    stunTimer: 0,
    burnTimer: 0,
    rootTimer: 0,
    slowRatio: 0,
    slowTimer: 0,
    knockupTimer: 0,
    shockTimer: 0,
    blindTimer: 0,
    freezeTimer: 0,
    dotEffects: [],
    facingAngle: 0,
    dashing: false,
    dashTarget: null,
    dashSpeed: 0,
    dashDamage: 0,
    dashStun: 0,
    dashSkillName: '',
    dead: false,
    respawnTimer: 0,
    spawnX: x,
    spawnY: y,
    invincibleTimer: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    captures: 0,
    defends: 0,
    damageDealt: 0,
    healingDone: 0,
    damageTaken: 0,
    ultCharge: 0,
    ultReady: false,
    ultCasting: 0,
    skillCasting: 0,
    skillRecovery: 0,
    pendingSkill: null,
    buffs: [],
    elemBuff: 0,
    elemDebuff: 0,
    elemChargeTimer: 0,
    elemChargeType: null,
    passives: sheet.passives,
    skills: sheet.skills.map(skillFromSheet),
  };
}

// ─── CharSheet → CharDef 호환 (기존 ALL_CHARS 대체) ───

export type CharFactory = (team: 'A' | 'B', x: number, y: number) => Entity;

export interface CharDef {
  name: string;
  factory: CharFactory;
  role: string;
  icon: string;
  desc: string;
  color: string;
}

export const ALL_CHARS: CharDef[] = SHEETS.map(sheet => ({
  name: sheet.name,
  factory: (team: 'A' | 'B', x: number, y: number) => createEntity(sheet, team, x, y),
  role: sheet.role,
  icon: sheet.icon,
  desc: sheet.desc,
  color: sheet.color,
}));

// ─── 역할별 랜덤 팀 구성 (원딜+근딜+탱커+서포터 각 1명) ───

/** 역할별 인덱스 맵 */
const ROLE_INDICES: Record<string, number[]> = {};
for (let i = 0; i < SHEETS.length; i++) {
  const role = SHEETS[i].combatRole;
  if (!ROLE_INDICES[role]) ROLE_INDICES[role] = [];
  ROLE_INDICES[role].push(i);
}

/** 역할별 1명씩 랜덤 선택 → 4명 인덱스 배열 반환 */
export function pickBalancedTeam(excludeIndices: Set<number> = new Set()): number[] {
  const team: number[] = [];
  for (const role of ['ranged', 'melee', 'tank', 'support']) {
    const candidates = (ROLE_INDICES[role] || []).filter(i => !excludeIndices.has(i));
    if (candidates.length === 0) continue;
    team.push(candidates[Math.floor(Math.random() * candidates.length)]);
  }
  return team;
}

// ─── CharSheet → UltimateDef 호환 (기존 ULTIMATES 대체) ───

export interface AffectedResult {
  damaged: Array<{ entity: Entity; amount: number }>;
  healed: Array<{ entity: Entity; amount: number }>;
  stunned: Array<{ entity: Entity; duration: number }>;
}

export interface UltimateDef {
  name: string;
  icon: string;
  castTime: number;
  color: string;
  screenColor: string;
  execute: (user: Entity, entities: Entity[]) => AffectedResult;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function buildUltExecute(sheet: CharSheet): (user: Entity, entities: Entity[]) => AffectedResult {
  const ult = sheet.ultimate;
  const fx = ult.effects || {};

  return (user: Entity, entities: Entity[]) => {
    const result: AffectedResult = { damaged: [], healed: [], stunned: [] };

    for (const e of entities) {
      if (e.dead) continue;
      const d = dist(user, e);
      if (d > ult.radius) continue;

      // 전방 각도 제한
      if (fx.frontAngle !== undefined) {
        const dx = e.x - user.x, dy = e.y - user.y;
        const angle = Math.atan2(dy, dx);
        const diff = Math.abs(angle - user.facingAngle);
        const aDiff = diff > Math.PI ? Math.PI * 2 - diff : diff;
        if (aDiff > fx.frontAngle) continue;
      }

      const isAlly = e.team === user.team;
      const isEnemy = !isAlly;

      // ── 아군 효과 ──
      if (isAlly) {
        if (fx.allyHeal) {
          const heal = fx.allyHeal;
          e.hp = Math.min(e.maxHp, e.hp + heal);
          result.healed.push({ entity: e, amount: heal });
        }
        if (fx.allyInvincible) {
          e.invincibleTimer = Math.max(e.invincibleTimer, fx.allyInvincible);
        }
        // 바위 전용: 아군+적 동시 처리
        if (fx.enemyDamage === undefined) continue;
      }

      // ── 적 효과 ──
      if (isEnemy && e.invincibleTimer > 0) continue;

      if (isEnemy) {
        let dmg = ult.damage;
        if (fx.distanceDecay) {
          dmg = Math.round(dmg * (1 - d / ult.radius * 0.5));
        }

        // 바위 전용 적 피해
        if (fx.enemyDamage !== undefined) dmg = fx.enemyDamage;

        if (dmg > 0) {
          e.hp -= dmg;
          result.damaged.push({ entity: e, amount: dmg });
        }

        const stun = fx.enemyStun !== undefined ? fx.enemyStun : ult.stunDuration;
        if (stun > 0) {
          e.stunTimer = Math.max(e.stunTimer, stun);
          result.stunned.push({ entity: e, duration: stun });
        }

        if (fx.burn) e.burnTimer = Math.max(e.burnTimer, fx.burn);
        if (fx.shock) e.shockTimer = Math.max(e.shockTimer, fx.shock);
        if (fx.blind) e.blindTimer = Math.max(e.blindTimer, fx.blind);
        if (fx.freeze) e.freezeTimer = Math.max(e.freezeTimer, fx.freeze);
        if (fx.pull && d > 1) {
          const pull = Math.min(d - 1, fx.pull);
          const dx = user.x - e.x, dy = user.y - e.y;
          e.x += (dx / d) * pull;
          e.y += (dy / d) * pull;
        }
        const kb = fx.knockback ?? fx.enemyKnockback;
        if (kb && d > 0.1) {
          const dx = e.x - user.x, dy = e.y - user.y;
          e.x += (dx / d) * kb;
          e.y += (dy / d) * kb;
        }
      }
    }

    return result;
  };
}

export const ULTIMATES: Record<string, UltimateDef> = {};
for (const sheet of SHEETS) {
  ULTIMATES[sheet.name] = {
    name: sheet.ultimate.name,
    icon: sheet.ultimate.icon,
    castTime: sheet.ultimate.castTime,
    color: sheet.ultimate.color,
    screenColor: sheet.ultimate.screenColor,
    execute: buildUltExecute(sheet),
  };
}

// ─── 궁극기 충전량 (공통 상수) ───

export const ULT_CHARGE = {
  kill: 30,
  assist: 15,
  capture: 20,
  defend: 10,
  perTick: 0.5,
  deathPenalty: 20,
  max: 100,
};

// re-export for convenience
export type { CharSheet, SkillSheet, PassiveSheet, FieldEffectType } from './char-sheet.js';
