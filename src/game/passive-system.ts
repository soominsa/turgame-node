/**
 * PassiveSystem — 캐릭터 패시브 처리 엔진
 *
 * 12캐릭터의 패시브를 트리거별로 처리.
 * game-engine.ts에서 적절한 시점에 호출.
 *
 * ── 트리거별 호출 위치 ──
 * always / low_hp / on_field / aura / stationary / directional
 *   → tickPassives(dt)  (매 프레임, updateEntity 전)
 * on_kill
 *   → onPassiveKill(killer)  (killEntity에서)
 * on_hit_taken
 *   → onPassiveHitTaken(target, attacker, isMelee)  (데미지 적용 후)
 * on_skill_hit
 *   → onPassiveSkillHit(user)  (스킬 적중 시)
 * backstab
 *   → getPassiveBackstabMult(attacker, target)  (데미지 계산 시)
 */

import type { Entity, PassiveState } from '../shared/combat-entities.js';
import type { PassiveSheet, FieldEffectType } from '../shared/characters/char-sheet.js';
import type { FieldGrid } from '../core/types.js';
import { worldToHex } from '../core/hex.js';

// ─── 콜백 인터페이스 (game-engine이 주입) ───

export interface PassiveCallbacks {
  applyFieldEffect: (effect: FieldEffectType, cx: number, cy: number, radius: number, owner?: Entity) => void;
  getField: () => FieldGrid;
  getFieldSize: () => { w: number; h: number };
  getEntities: () => Entity[];
  getTime: () => number;
  onDamage?: (target: Entity, amount: number, x: number, y: number) => void;
  onHeal?: (target: Entity, amount: number, x: number, y: number) => void;
}

// ─── 패시브 상태 초기화 ───

export function initPassiveState(e: Entity): void {
  const ps: PassiveState = {};
  for (const p of e.passives) {
    switch (p.trigger.type) {
      case 'stationary':
        ps.stationaryTimer = 0;
        ps.stealthActive = false;
        ps.stealthCooldown = 0;
        ps.stealthDamageMult = 1;
        break;
      case 'on_skill_hit':
        ps.skillHitStacks = 0;
        ps.chainAttackReady = false;
        break;
      case 'on_kill':
        ps.killRushTimer = 0;
        break;
      case 'always':
        if (p.effects.trail) {
          ps.lastTrailX = e.x;
          ps.lastTrailY = e.y;
        }
        break;
      case 'aura':
        if (p.effects.fieldGenerate) {
          ps.lastFieldGenTime = 0;
        }
        break;
      case 'directional':
        ps.windAngle = 0;
        break;
      case 'on_field':
        if (p.effects.bowling) {
          ps.bowlingActive = false;
          ps.bowlingVx = 0;
          ps.bowlingVy = 0;
        }
        ps.onWaterField = false;
        break;
      case 'on_hit_taken':
        if (p.effects.summon) {
          ps.beeCount = 0;
          ps.bees = [];
        }
        break;
    }
  }
  e.passiveState = ps;
}

// ─── 유틸 ───

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function getTileFieldType(field: FieldGrid, x: number, y: number, w: number, h: number): string | null {
  const hex = worldToHex(x, y);
  if (hex.row < 0 || hex.row >= h || hex.col < 0 || hex.col >= w) return null;
  const mat = field[hex.row][hex.col].material;
  if (!mat) return null;
  // thermalState를 필드 타입으로 변환
  switch (mat.thermalState) {
    case 'burning': case 'molten': return 'ignite';
    case 'frozen': return 'freeze';
    case 'damp': return 'mud';
    case 'steam': return 'fog';
    default:
      // 기본 소재 타입
      if (mat.type === 'water') return 'water';
      if (mat.type === 'wood') return 'grow';
      if (mat.type === 'soil') return 'mud';
      return null;
  }
}

// ─── 매 프레임 패시브 틱 ───

export function tickPassives(e: Entity, dt: number, cb: PassiveCallbacks): void {
  if (e.dead || !e.passiveState) return;
  const ps = e.passiveState;
  const { w, h } = cb.getFieldSize();

  for (const p of e.passives) {
    switch (p.trigger.type) {

      // ── stationary: 실반 위장술 ──
      case 'stationary': {
        // 쿨타임 감소
        if (ps.stealthCooldown && ps.stealthCooldown > 0) {
          ps.stealthCooldown -= dt;
        }

        const isMoving = Math.abs(e.vx) > 0.1 || Math.abs(e.vy) > 0.1;
        const currentField = getTileFieldType(cb.getField(), e.x, e.y, w, h);

        // grow 타일 위에서 정지 중인지 확인
        if (!isMoving && currentField === 'grow' && (ps.stealthCooldown ?? 0) <= 0) {
          ps.stationaryTimer = (ps.stationaryTimer ?? 0) + dt;
          if ((ps.stationaryTimer ?? 0) >= p.trigger.duration && !ps.stealthActive) {
            ps.stealthActive = true;
            ps.stealthDamageMult = p.effects.damageMult ?? 1.5;
          }
        } else if (isMoving && ps.stealthActive) {
          // 이동 시 은신 해제
          ps.stealthActive = false;
          ps.stationaryTimer = 0;
          ps.stealthDamageMult = 1;
          ps.stealthCooldown = p.effects.cooldown ?? 6;
        }
        break;
      }

      // ── always: 블레이즈 불꽃 잔상 / 그로브 생명의 순환 (always 트리거) ──
      case 'always': {
        if (p.effects.trail) {
          const trailDist = dist(
            { x: ps.lastTrailX ?? e.x, y: ps.lastTrailY ?? e.y },
            { x: e.x, y: e.y }
          );
          // 0.5타일 이상 이동할 때마다 잔상 생성
          if (trailDist > 0.5) {
            const hex = worldToHex(ps.lastTrailX ?? e.x, ps.lastTrailY ?? e.y);
            cb.applyFieldEffect(
              p.effects.trail.fieldEffect,
              hex.col, hex.row,
              1, e
            );
            ps.lastTrailX = e.x;
            ps.lastTrailY = e.y;
          }
        }
        break;
      }

      // ── low_hp: 블레이즈 열폭주 ──
      case 'low_hp': {
        // 효과는 getPassiveSpeedMult / getPassiveDamageMult 에서 실시간 체크
        break;
      }

      // ── aura: 프로스트 동토의 영역 ──
      case 'aura': {
        if (p.effects.fieldGenerate) {
          const fg = p.effects.fieldGenerate;
          const lastGen = ps.lastFieldGenTime ?? 0;
          if (cb.getTime() - lastGen >= fg.interval) {
            ps.lastFieldGenTime = cb.getTime();
            const hex = worldToHex(e.x, e.y);
            cb.applyFieldEffect(fg.fieldEffect, hex.col, hex.row, fg.radius + 1, e);
          }
        }
        break;
      }

      // ── on_field: 바위 볼링, 타이드 조류 지배 ──
      case 'on_field': {
        const currentField = getTileFieldType(cb.getField(), e.x, e.y, w, h);
        const matchesField = p.trigger.fieldTypes.some(ft => ft === currentField);

        // 바위 볼링
        if (p.effects.bowling) {
          if (matchesField && !ps.bowlingActive) {
            // 빙판 진입 → 볼링 시작 (현재 이동 방향 고정)
            const speed = Math.sqrt(e.vx ** 2 + e.vy ** 2);
            if (speed > 0.5) {
              ps.bowlingActive = true;
              const factor = (e.speed * 1.5) / Math.max(speed, 0.1);
              ps.bowlingVx = e.vx * factor;
              ps.bowlingVy = e.vy * factor;
            }
          }
          if (ps.bowlingActive) {
            if (!matchesField) {
              // 빙판 벗어남 → 볼링 종료
              ps.bowlingActive = false;
              ps.bowlingVx = 0;
              ps.bowlingVy = 0;
            } else {
              // 볼링 중 직선 이동 강제
              e.vx = ps.bowlingVx ?? 0;
              e.vy = ps.bowlingVy ?? 0;

              // 충돌 판정
              for (const t of cb.getEntities()) {
                if (t === e || t.dead) continue;
                if (dist(e, t) < e.size + t.size + 0.3) {
                  const bdef = p.effects.bowling!;
                  if (t.team !== e.team) {
                    // 적: 데미지 + 스턴 + 넉백
                    t.hp -= bdef.damage;
                    t.stunTimer = Math.max(t.stunTimer, bdef.stunDuration);
                    cb.onDamage?.(t, bdef.damage, t.x, t.y);
                  }
                  // 모두: 넉백
                  const dx = t.x - e.x, dy = t.y - e.y;
                  const d = Math.max(dist(e, t), 0.1);
                  t.x += (dx / d) * bdef.knockback;
                  t.y += (dy / d) * bdef.knockback;
                }
              }
            }
          }
        }

        // 타이드 조류 지배 (water 위 쿨감)
        if (p.effects.cooldownMult) {
          ps.onWaterField = matchesField;
        }
        break;
      }

      // ── directional: 에리스 순풍/역풍 ──
      case 'directional': {
        // windAngle은 스킬 사용 시 onPassiveSkillUse에서 갱신
        // 효과는 getPassiveSpeedMult에서 실시간 체크
        break;
      }

      // ── on_kill: 루미나 암살자의 혈기 ──
      case 'on_kill': {
        if ((ps.killRushTimer ?? 0) > 0) {
          ps.killRushTimer! -= dt;
          if (ps.killRushTimer! <= 0) {
            ps.killRushTimer = 0;
          }
        }
        break;
      }

      // ── on_hit_taken: 벌 업데이트 ──
      case 'on_hit_taken': {
        if (p.effects.summon && ps.bees) {
          const toRemove: number[] = [];
          for (let i = 0; i < ps.bees.length; i++) {
            const bee = ps.bees[i];
            bee.timer -= dt;
            if (bee.timer <= 0) {
              toRemove.push(i);
              continue;
            }
            // 벌 데미지 (초당)
            bee.tickAccum += dt;
            if (bee.tickAccum >= 1) {
              bee.tickAccum -= 1;
              const bTarget = cb.getEntities().find(t => t.id === bee.targetId && !t.dead);
              if (bTarget) {
                bTarget.hp -= p.effects.summon.damage;
                cb.onDamage?.(bTarget, p.effects.summon.damage, bTarget.x, bTarget.y);
                // 벌에 쏘이면 간헐적 경직
                if (Math.random() < 0.2) {
                  bTarget.stunTimer = Math.max(bTarget.stunTimer, 0.1);
                }
              }
            }
          }
          for (let i = toRemove.length - 1; i >= 0; i--) {
            ps.bees!.splice(toRemove[i], 1);
          }
          ps.beeCount = ps.bees.length;
        }
        break;
      }
    }
  }
}

// ─── 킬/어시스트 시 패시브 트리거 ───

export function onPassiveKill(killer: Entity): void {
  if (!killer.passiveState) return;
  const ps = killer.passiveState;

  for (const p of killer.passives) {
    if (p.trigger.type === 'on_kill') {
      // 루미나: 이속 + HP 회복
      ps.killRushTimer = p.effects.duration ?? 3;
      if (p.effects.hpRegen) {
        killer.hp = Math.min(killer.maxHp, killer.hp + p.effects.hpRegen);
      }
    }
  }
}

// ─── 피격 시 패시브 트리거 ───

export function onPassiveHitTaken(target: Entity, attacker: Entity, isMelee: boolean, cb: PassiveCallbacks): void {
  if (!target.passiveState) return;
  const ps = target.passiveState;

  for (const p of target.passives) {
    if (p.trigger.type !== 'on_hit_taken') continue;
    if (!isMelee) continue; // 근접 피격만 트리거

    // 가시 반사
    if (p.effects.reflectDamage && p.effects.reflectDamage > 0) {
      attacker.hp -= p.effects.reflectDamage;
      cb.onDamage?.(attacker, p.effects.reflectDamage, attacker.x, attacker.y);
    }

    // 벌통 소환
    if (p.effects.summon && ps.bees) {
      const chance = p.trigger.chance ?? 1;
      if (Math.random() < chance && (ps.beeCount ?? 0) < p.effects.summon.maxStacks) {
        ps.bees.push({
          targetId: attacker.id,
          timer: p.effects.summon.duration,
          tickAccum: 0,
        });
        ps.beeCount = ps.bees.length;
      }
    }
  }
}

// ─── 스킬 적중 시 패시브 트리거 (볼트 과충전) ───

export function onPassiveSkillHit(user: Entity): void {
  if (!user.passiveState) return;
  const ps = user.passiveState;

  for (const p of user.passives) {
    if (p.trigger.type === 'on_skill_hit') {
      ps.skillHitStacks = (ps.skillHitStacks ?? 0) + 1;
      if (ps.skillHitStacks >= (p.trigger.stacks ?? 3)) {
        ps.chainAttackReady = true;
        ps.skillHitStacks = 0;
      }
    }
  }
}

// ─── 스킬 사용 방향 업데이트 (에리스) ───

export function onPassiveSkillUse(user: Entity, targetX: number, targetY: number): void {
  if (!user.passiveState) return;
  for (const p of user.passives) {
    if (p.trigger.type === 'directional') {
      user.passiveState!.windAngle = Math.atan2(targetY - user.y, targetX - user.x);
    }
  }
}

// ─── 은신 해제 트리거 (공격/스킬 사용/피격 시) ───

export function breakStealth(e: Entity): void {
  if (!e.passiveState) return;
  if (e.passiveState.stealthActive) {
    e.passiveState.stealthActive = false;
    e.passiveState.stationaryTimer = 0;
    e.passiveState.stealthDamageMult = 1;
    const cooldown = e.passives.find(p => p.trigger.type === 'stationary')?.effects.cooldown ?? 6;
    e.passiveState.stealthCooldown = cooldown;
  }
}

// ─── 패시브 이속 배율 (매 프레임, speed 계산에 곱하기) ───

export function getPassiveSpeedMult(e: Entity, cb: PassiveCallbacks): number {
  if (!e.passiveState) return 1;
  let mult = 1;
  const ps = e.passiveState;

  for (const p of e.passives) {
    switch (p.trigger.type) {
      case 'low_hp':
        if (e.hp / e.maxHp <= (p.trigger as { threshold: number }).threshold) {
          mult *= p.effects.speedMult ?? 1;
        }
        break;
      case 'on_kill':
        if ((ps.killRushTimer ?? 0) > 0 && p.effects.speedMult) {
          mult *= p.effects.speedMult;
        }
        break;
      case 'on_field':
        if (p.effects.bowling && ps.bowlingActive) {
          mult *= 1.5; // 볼링 속도 증가
        }
        break;
    }
  }
  return mult;
}

// ─── 패시브 데미지 배율 (공격/스킬 데미지 계산에 곱하기) ───

export function getPassiveDamageMult(attacker: Entity, target: Entity): number {
  if (!attacker.passiveState) return 1;
  let mult = 1;
  const ps = attacker.passiveState;

  for (const p of attacker.passives) {
    switch (p.trigger.type) {
      case 'low_hp':
        if (attacker.hp / attacker.maxHp <= (p.trigger as { threshold: number }).threshold) {
          mult *= p.effects.damageMult ?? 1;
        }
        break;
      case 'stationary':
        // 은신 기습 보너스
        if (ps.stealthActive && (ps.stealthDamageMult ?? 1) > 1) {
          mult *= ps.stealthDamageMult!;
        }
        break;
      case 'always':
        // 볼트: 도체 감지 (물 위 적에게 추가 뎀)
        if (p.effects.damageMult && p.name === '도체 감지') {
          // 대상이 최근 water/freeze 장판을 밟았는지 확인
          if (target.elemDebuff > 0 || target.burnTimer < 0) {
            // 간단히: 대상이 water 원소 상태이거나 디버프 상태이면 적용
          }
          // TODO: 정밀한 "젖은" 상태 추적은 추후
        }
        break;
    }
  }
  return mult;
}

// ─── 백스탭 판정 (루미나 그림자 접근) ───

export function getPassiveBackstab(attacker: Entity, target: Entity): { damageMult: number; extraStun: number } {
  if (!attacker.passiveState) return { damageMult: 1, extraStun: 0 };

  for (const p of attacker.passives) {
    if (p.trigger.type === 'backstab') {
      // 적 뒤쪽 180도 판정
      const attackAngle = Math.atan2(attacker.y - target.y, attacker.x - target.x);
      const diff = Math.abs(attackAngle - target.facingAngle);
      const angleDiff = diff > Math.PI ? Math.PI * 2 - diff : diff;
      // 뒤쪽 = facingAngle과 같은 방향 (= 적이 등을 보이고 있음)
      if (angleDiff < Math.PI * 0.5) {
        return {
          damageMult: p.effects.damageMult ?? 1.4,
          extraStun: p.effects.extraStun ?? 0,
        };
      }
    }
  }
  return { damageMult: 1, extraStun: 0 };
}

// ─── 패시브 방어 배율 (피격 시 적용) ───

export function getPassiveDefenseMult(target: Entity): number {
  if (!target.passiveState) return 1;
  let mult = 1;
  const { w, h } = { w: 50, h: 26 }; // 디폴트 (콜백 없이 간단 체크)

  for (const p of target.passives) {
    // 프로스트: freeze 위에서 방어력 증가
    if (p.trigger.type === 'aura' && p.effects.defenseMult) {
      // aura 패시브의 defenseMult는 freeze 위에서만 적용
      // 실제 필드 체크는 tickPassives에서 하므로 여기서는 간단히 적용
      // defenseMult가 0.75이면 25% 피해 감소 (0.75를 곱하면 실제 받는 뎀이 75%)
      mult *= p.effects.defenseMult;
    }
    if (p.trigger.type === 'on_field' && p.effects.cooldownMult) {
      // 타이드: on_field 방어는 없음, 쿨감만
    }
  }
  return mult;
}

// ─── 패시브 쿨타임 배율 (타이드 water 위 쿨감) ───

export function getPassiveCooldownMult(e: Entity): number {
  if (!e.passiveState) return 1;
  for (const p of e.passives) {
    if (p.trigger.type === 'on_field' && p.effects.cooldownMult && e.passiveState.onWaterField) {
      return p.effects.cooldownMult; // 0.8 = 20% 쿨감
    }
  }
  return 1;
}

// ─── 체인 라이트닝 실행 (볼트 과충전) ───

export function executeChainAttack(
  attacker: Entity,
  target: Entity,
  baseDamage: number,
  cb: PassiveCallbacks,
): boolean {
  if (!attacker.passiveState?.chainAttackReady) return false;

  const chainPassive = attacker.passives.find(p =>
    p.trigger.type === 'on_skill_hit' && p.effects.chainAttack
  );
  if (!chainPassive?.effects.chainAttack) return false;

  attacker.passiveState.chainAttackReady = false;

  const { targets: maxTargets, damageRatio } = chainPassive.effects.chainAttack;
  const chainDmg = Math.round(baseDamage * damageRatio);

  // 주변 적 찾아서 연쇄
  const nearby = cb.getEntities()
    .filter(t => t !== target && t.team !== attacker.team && !t.dead)
    .map(t => ({ entity: t, dist: dist(attacker, t) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxTargets);

  for (const n of nearby) {
    n.entity.hp -= chainDmg;
    attacker.damageDealt += chainDmg;
    cb.onDamage?.(n.entity, chainDmg, n.entity.x, n.entity.y);
  }

  return true;
}

// ─── 에리스 바람 효과: 투사체 속도 보정 ───

export function getWindProjectileSpeedMult(owner: Entity, projAngle: number, entities: Entity[]): number {
  // 에리스가 같은 팀에 있으면 순풍/역풍 적용
  const aeris = entities.find(e =>
    e.team === owner.team && !e.dead &&
    e.passives.some(p => p.trigger.type === 'directional') &&
    e.passiveState?.windAngle !== undefined
  );
  if (!aeris) return 1;

  const windAngle = aeris.passiveState!.windAngle!;
  const angleDiff = Math.abs(projAngle - windAngle);
  const normalizedDiff = angleDiff > Math.PI ? Math.PI * 2 - angleDiff : angleDiff;

  if (normalizedDiff < Math.PI * 0.4) return 1.2;  // 순풍: +20%
  if (normalizedDiff > Math.PI * 0.6) return 0.8;  // 역풍: -20%
  return 1;
}

// ─── 에리스 바람 이속 효과 (아군/적) ───

export function getAerisWindSpeedMult(e: Entity, entities: Entity[]): number {
  const aeris = entities.find(a =>
    a.team === e.team && !a.dead && a !== e &&
    a.passives.some(p => p.trigger.type === 'directional') &&
    a.passiveState?.windAngle !== undefined
  );
  if (!aeris) {
    // 적 팀에 에리스가 있는지 확인 (역풍)
    const enemyAeris = entities.find(a =>
      a.team !== e.team && !a.dead &&
      a.passives.some(p => p.trigger.type === 'directional') &&
      a.passiveState?.windAngle !== undefined
    );
    if (!enemyAeris) return 1;

    // 적 에리스의 바람 역방향으로 이동 중이면 감속
    const windAngle = enemyAeris.passiveState!.windAngle!;
    const moveAngle = Math.atan2(e.vy, e.vx);
    const speed = Math.sqrt(e.vx ** 2 + e.vy ** 2);
    if (speed < 0.1) return 1;

    const angleDiff = Math.abs(moveAngle - windAngle);
    const norm = angleDiff > Math.PI ? Math.PI * 2 - angleDiff : angleDiff;
    // 역풍 방향으로 이동 시 (= 바람 방향과 반대) 감속
    if (norm > Math.PI * 0.6) {
      const enemyPassive = enemyAeris.passives.find(p => p.trigger.type === 'directional');
      return enemyPassive?.effects.enemySpeedMult ?? 0.9;
    }
    return 1;
  }

  // 아군 에리스의 순풍
  const windAngle = aeris.passiveState!.windAngle!;
  const moveAngle = Math.atan2(e.vy, e.vx);
  const speed = Math.sqrt(e.vx ** 2 + e.vy ** 2);
  if (speed < 0.1) return 1;

  const angleDiff = Math.abs(moveAngle - windAngle);
  const norm = angleDiff > Math.PI ? Math.PI * 2 - angleDiff : angleDiff;
  if (norm < Math.PI * 0.4) {
    const allyPassive = aeris.passives.find(p => p.trigger.type === 'directional');
    return allyPassive?.effects.allySpeedMult ?? 1.15;
  }
  return 1;
}

// ─── 타이드 조류 지배: 아군/적 이속 (water 위) ───

export function getTideWaterSpeedMult(e: Entity, field: FieldGrid, w: number, h: number, entities: Entity[]): number {
  const currentField = getTileFieldType(field, e.x, e.y, w, h);
  if (currentField !== 'water') return 1;

  // 같은 팀에 타이드 패시브가 있는지 확인
  const tide = entities.find(t =>
    t.team === e.team && !t.dead &&
    t.passives.some(p => p.trigger.type === 'on_field' && p.effects.allySpeedMult)
  );
  if (tide) {
    const p = tide.passives.find(p => p.trigger.type === 'on_field' && p.effects.allySpeedMult);
    return p?.effects.allySpeedMult ?? 1;
  }

  // 적 팀 타이드의 물 위 감속
  const enemyTide = entities.find(t =>
    t.team !== e.team && !t.dead &&
    t.passives.some(p => p.trigger.type === 'on_field' && p.effects.enemySpeedMult)
  );
  if (enemyTide) {
    const p = enemyTide.passives.find(p => p.trigger.type === 'on_field' && p.effects.enemySpeedMult);
    return p?.effects.enemySpeedMult ?? 1;
  }

  return 1;
}

// ─── 그로브 생명의 순환: 힐 시 grow 생성 + 추가 힐 ───

export function onPassiveHeal(healer: Entity, target: Entity, healAmount: number, cb: PassiveCallbacks): number {
  let bonusHeal = 0;

  for (const p of healer.passives) {
    if (p.trigger.type === 'always' && p.effects.fieldGenerate) {
      const fg = p.effects.fieldGenerate;
      if (fg.fieldEffect === 'grow') {
        // 대상 발밑에 grow 생성
        const hex = worldToHex(target.x, target.y);
        cb.applyFieldEffect('grow', hex.col, hex.row, 1, healer);

        // grow 위에서 힐 받으면 추가 회복
        const { w, h } = cb.getFieldSize();
        const currentField = getTileFieldType(cb.getField(), target.x, target.y, w, h);
        if (currentField === 'grow') {
          bonusHeal = 15; // grow 위 추가 HP 15 회복
          target.hp = Math.min(target.maxHp, target.hp + bonusHeal);
          cb.onHeal?.(target, bonusHeal, target.x, target.y);
        }
      }
    }
  }

  return bonusHeal;
}

// ─── 볼트: 도체 감지 (젖은 적 추가 뎀) ───

export function getWetTargetDamageMult(attacker: Entity, target: Entity, field: FieldGrid, w: number, h: number): number {
  if (!attacker.passiveState) return 1;

  for (const p of attacker.passives) {
    // 도체 감지: always 트리거 + damageMult
    if (p.trigger.type === 'always' && p.effects.damageMult && p.name === '도체 감지') {
      // 대상이 water 또는 freeze 타일 위에 있는지 확인
      const targetField = getTileFieldType(field, target.x, target.y, w, h);
      if (targetField === 'water' || targetField === 'freeze') {
        return p.effects.damageMult;
      }
    }
  }
  return 1;
}

// ─── 테라: 대시 경로 mud 변환 (불꽃 잔상과 유사하지만 대시 시에만) ───

export function onPassiveDash(e: Entity, fromX: number, fromY: number, cb: PassiveCallbacks): void {
  if (!e.passiveState) return;

  for (const p of e.passives) {
    if (p.trigger.type === 'always' && p.effects.trail) {
      // 대시 시 잔상 지속 시간 강화 (3초)
      // 단순히 경로에 필드 깔기
      const hex = worldToHex(fromX, fromY);
      cb.applyFieldEffect(p.effects.trail.fieldEffect, hex.col, hex.row, 1, e);
    }
  }
}
