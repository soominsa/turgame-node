/**
 * 쏜 — 가시의 전사
 * 역할: 근딜 (자연 근접)
 *
 * 가시 갑옷으로 반격하며 싸우는 생존형 근딜.
 * 가시 찌르기로 단일 폭딜, 덩굴 속박으로 CC.
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
  desc: '가시 전사, 반격, 속박',
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
      name: '가시 돌진',
      type: 'damage',
      cooldown: 8,
      initialCooldown: 2,
      damage: 22,
      range: 5,
      stunDuration: 0.5,
      aoe: 0,
      attackAngle: Math.PI,
      windupTime: 0.1,
      recoveryTime: 0,          // dash = no recovery
      vfx: { cast: 'pm_earth1', hit: 'cm_weaponhit' },
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
