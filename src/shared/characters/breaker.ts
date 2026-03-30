/**
 * 페룸 — 붕괴의 마법사
 * 역할: 붕괴 (원거리 마법)
 *
 * 방전/방화/진흙으로 지형을 지배하는 컨트롤 메이지.
 * 붕괴로 넓은 범위 스턴. 궁극기 용광로로 거리 감쇠 화상 폭발.
 */

import type { CharSheet } from './char-sheet.js';

const breaker: CharSheet = {
  // ── 기본 정보 ──
  id: 'breaker',
  name: '페룸',
  role: '붕괴',
  combatRole: 'ranged',
  element: 'fire',
  icon: '⚡',
  desc: '방전, 방화, 붕괴',
  color: '#AA88CC',
  colorAlt: '#886699',

  // ── 기본 스탯 ──
  hp: 125,
  speed: 3.5,
  size: 0.45,

  // ── 기본 공격 ──
  attackDamage: 10,
  attackSpeed: 0.7,
  attackRange: 9,

  // ── 패시브 (없음 — 4스킬로 승부) ──
  passives: [],

  // ── 스킬 ──
  skills: [
    {
      name: '방전',
      type: 'damage',
      cooldown: 5,
      initialCooldown: 0,
      damage: 20,
      range: 10,
      stunDuration: 0.3,
      aoe: 0,
      projectileSpeed: 22,
      tracking: 'loose',
      windupTime: 0.18,
      recoveryTime: 0.12,
      vfx: { hit: 'fz_molten_spear' },
    },
    {
      name: '방화',
      type: 'field',
      cooldown: 7,
      initialCooldown: 2,
      damage: 20,
      range: 12,
      stunDuration: 0,
      aoe: 5,
      fieldEffect: 'ignite',
      windupTime: 0.2,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.3,
      vfx: { cast: 'cm_fire', hit: 'cm_firespin', scale: 1.2 },
    },
    {
      name: '진흙',
      type: 'cc',
      cooldown: 6,
      initialCooldown: 3,
      damage: 15,
      range: 10,
      stunDuration: 2,
      aoe: 4,
      fieldEffect: 'mud',
      windupTime: 0.2,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.5,
      vfx: { hit: 'fz_rocks' },
    },
    {
      name: '붕괴',
      type: 'cc',
      cooldown: 30,
      initialCooldown: 15,
      damage: 30,
      range: 8,
      stunDuration: 2.5,
      aoe: 6,
      windupTime: 0.2,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.8,
      vfx: { hit: 'fz_earth_spike', scale: 1.2 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '용광로',
    icon: '🌋',
    castTime: 0.8,
    color: '#FF6600',
    screenColor: 'rgba(255,102,0,0.4)',
    radius: 8,
    damage: 40,
    stunDuration: 1.0,
    effects: {
      distanceDecay: true,
      burn: 3.0,
    },
    vfx: { cast: 'fz_molten_spear', hit: 'fz_explosion', scale: 1.5 },
  },
};

export default breaker;
