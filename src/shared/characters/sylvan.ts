/**
 * 실반 — 숲의 사냥꾼
 * 역할: 원딜 (원거리)
 *
 * 빠른 이동속도와 원거리 투사체로 안전하게 딜링.
 * 덩굴로 지속 견제, 독침으로 스턴. 궁극기로 광역 독안개.
 */

import type { CharSheet } from './char-sheet.js';

const sylvan: CharSheet = {
  // ── 기본 정보 ──
  id: 'sylvan',
  name: '실반',
  role: '원딜',
  combatRole: 'ranged',
  element: 'nature',
  icon: '🏹',
  desc: '원거리, 덩굴, 독침',
  color: '#44AA44',
  colorAlt: '#228822',

  // ── 기본 스탯 ──
  hp: 130,
  speed: 4.5,
  size: 0.5,

  // ── 기본 공격 ──
  attackDamage: 20,
  attackSpeed: 1.3,
  attackRange: 9,

  // ── 스킬 ──
  skills: [
    {
      name: '덩굴 화살',
      type: 'damage',
      cooldown: 2,
      initialCooldown: 0,
      damage: 30,
      range: 10,
      stunDuration: 0,
      aoe: 0,
      projectileSpeed: 20,
      tracking: 'loose',
      windupTime: 0.18,
      recoveryTime: 0.12,
      vfx: { hit: 'pm_earth1' },
    },
    {
      name: '독침',
      type: 'cc',
      cooldown: 6,
      initialCooldown: 3,
      damage: 15,
      range: 10,
      stunDuration: 0.8,
      aoe: 0,
      projectileSpeed: 15,
      tracking: 'loose',
      windupTime: 0.18,
      recoveryTime: 0.12,
      vfx: { cast: 'pm_poison', hit: 'pm_earth2' },
    },
    {
      name: '독안개 화살',
      type: 'damage',
      cooldown: 5,
      initialCooldown: 2,
      damage: 35,
      range: 10,
      stunDuration: 0.3,
      aoe: 3,
      windupTime: 0.2,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.5,
      fieldEffect: 'grow',
      vfx: { cast: 'pm_poison', hit: 'cm_vortex', scale: 1.3 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '독안개',
    icon: '☠️',
    castTime: 0.5,
    color: '#44AA44',
    screenColor: 'rgba(68,170,68,0.35)',
    radius: 9,
    damage: 45,
    stunDuration: 0.8,
    vfx: { cast: 'pm_poison', hit: 'cm_vortex', scale: 1.5 },
  },
};

export default sylvan;
