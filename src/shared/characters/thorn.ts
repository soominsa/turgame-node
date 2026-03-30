/**
 * 쏜 — 건드리면 큰일나는 가시 덤불
 * 역할: 근딜 (자연 근접)
 *
 * 근접 피격 시 반사 데미지(가시 반사) + 확률적 벌 소환(벌통).
 * 가시 덫을 설치하고 덩굴 속박으로 적을 끌어와 처치.
 */

import type { CharSheet } from './char-sheet.js';

const thorn: CharSheet = {
  // ── 기본 정보 ──
  id: 'thorn',
  name: '쏜',
  role: '근딜',
  combatRole: 'melee',
  element: 'nature',
  icon: '🌿',
  desc: '가시 반사, 벌 소환, 덫',
  color: '#66AA33',
  colorAlt: '#448822',

  // ── 기본 스탯 ──
  hp: 160,
  speed: 5.0,
  size: 0.5,

  // ── 기본 공격 ──
  attackDamage: 16,
  attackSpeed: 1.2,
  attackRange: 2.2,

  // ── 패시브 ──
  passives: [
    {
      name: '가시 반사',
      icon: '🌵',
      desc: '근접 피격 시 공격자에게 반사 데미지 5.',
      trigger: { type: 'on_hit_taken' },
      effects: {
        reflectDamage: 5,
      },
      vfx: { hit: 'pm_earth1' },
    },
    {
      name: '벌통',
      icon: '🐝',
      desc: '근접 피격 시 15% 확률로 벌 소환. 벌은 5초간 적을 추적 (2뎀/초). 최대 3마리.',
      trigger: { type: 'on_hit_taken', chance: 0.15 },
      effects: {
        summon: { type: 'bee', damage: 2, duration: 5, maxStacks: 3 },
      },
      vfx: { cast: 'pm_poison' },
    },
  ],

  // ── 스킬 ──
  skills: [
    {
      name: '가시 찌르기',
      type: 'damage',
      cooldown: 3,
      initialCooldown: 0,
      damage: 28,
      range: 3,
      stunDuration: 0.3,
      aoe: 0,
      attackAngle: Math.PI * 0.5,
      windupTime: 0.1,
      recoveryTime: 0.2,
      vfx: { hit: 'pm_earth1' },
    },
    {
      name: '덩굴 속박',
      type: 'cc',
      cooldown: 8,
      initialCooldown: 3,
      damage: 10,
      range: 7,
      stunDuration: 2.0,
      aoe: 0,
      projectileSpeed: 18,
      tracking: 'loose',
      windupTime: 0.12,
      recoveryTime: 0.12,
      fieldEffect: 'grow',
      vfx: { cast: 'pm_poison', hit: 'pm_earth2' },
    },
    {
      name: '가시 덫',
      type: 'trap',
      cooldown: 8,
      initialCooldown: 2,
      damage: 15,
      range: 6,
      stunDuration: 0,
      aoe: 0,
      windupTime: 0.15,
      recoveryTime: 0.2,
      slow: { ratio: 0.4, duration: 1.5 },                // 이속 40% 감소 1.5초
      trap: { count: 3, lifetime: 30, hidden: true },      // 3개, 30초, grow 위 은폐
      vfx: { cast: 'pm_earth2', hit: 'pm_earth1' },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '가시 폭풍',
    icon: '🌿',
    castTime: 0.6,
    color: '#66AA33',
    screenColor: 'rgba(102,170,51,0.4)',
    radius: 9,
    damage: 35,
    stunDuration: 1.5,
    vfx: { cast: 'pm_poison', hit: 'cm_vortex', scale: 1.5 },
  },
};

export default thorn;
