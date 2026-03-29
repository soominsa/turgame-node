/**
 * 루미나 — 빛의 암살자
 * 역할: 암살 (고속 근접)
 *
 * 최고 이동속도와 공격속도로 적 후방을 기습.
 * 섬광으로 순간 폭딜, 실명으로 범위 스턴. 궁극기로 시간 정지.
 */

import type { CharSheet } from './char-sheet.js';

const lumina: CharSheet = {
  // ── 기본 정보 ──
  id: 'lumina',
  name: '루미나',
  role: '암살',
  combatRole: 'melee',
  element: 'nature',
  icon: '⚔',
  desc: '고속 근접, 섬광',
  color: '#FFCC44',
  colorAlt: '#CCAA22',

  // ── 기본 스탯 ──
  hp: 180,
  speed: 6.0,
  size: 0.4,

  // ── 기본 공격 ──
  attackDamage: 25,
  attackSpeed: 1.8,
  attackRange: 2.5,

  // ── 스킬 ──
  skills: [
    {
      name: '섬광',
      type: 'damage',
      cooldown: 3,
      initialCooldown: 0,
      damage: 50,
      range: 4,
      stunDuration: 0.8,
      aoe: 0,
      attackAngle: Math.PI * 0.4,
      windupTime: 0.1,
      recoveryTime: 0,          // dash = no recovery
      vfx: { cast: 'cm_brightfire', hit: 'cm_magichit' },
    },
    {
      name: '그림자 표창',
      type: 'cc',
      cooldown: 5,
      initialCooldown: 1,
      damage: 20,
      range: 10,
      stunDuration: 1.0,
      aoe: 0,
      projectileSpeed: 25,
      tracking: 'loose',
      windupTime: 0.12,
      recoveryTime: 0.12,
      vfx: { hit: 'pm_dark' },
    },
    {
      name: '실명',
      type: 'cc',
      cooldown: 8,
      initialCooldown: 4,
      damage: 15,
      range: 8,
      stunDuration: 2.5,
      aoe: 4,
      windupTime: 0.12,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.4,
      vfx: { cast: 'cm_brightfire', hit: 'pm_dark', scale: 1.2 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '시간 정지',
    icon: '⏳',
    castTime: 0.1,
    color: '#FFDD44',
    screenColor: 'rgba(255,221,68,0.45)',
    radius: 10,
    damage: 35,
    stunDuration: 3.0,
    vfx: { cast: 'cm_magicspell', hit: 'cm_flamelash', scale: 1.5 },
  },
};

export default lumina;
