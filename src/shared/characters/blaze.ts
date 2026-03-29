/**
 * 블레이즈 — 화염의 검사
 * 역할: 근딜 (화염 근접)
 *
 * 화염을 두른 검으로 적을 베는 근접 딜러.
 * 화염 돌진으로 진입, 화염 폭풍으로 범위 피해+화상.
 */

import type { CharSheet } from './char-sheet.js';

const blaze: CharSheet = {
  // ── 기본 정보 ──
  id: 'blaze',
  name: '블레이즈',
  role: '근딜',
  combatRole: 'melee',
  element: 'fire',
  icon: '🔥',
  desc: '화염 검사, 돌진, 화상',
  color: '#FF6622',
  colorAlt: '#CC4400',

  // ── 기본 스탯 ──
  hp: 150,
  speed: 5.2,
  size: 0.45,

  // ── 기본 공격 ──
  attackDamage: 20,
  attackSpeed: 1.5,
  attackRange: 2.0,

  // ── 스킬 ──
  skills: [
    {
      name: '화염 돌진',
      type: 'damage',
      cooldown: 8,
      initialCooldown: 3,
      damage: 25,
      range: 5,
      stunDuration: 0.3,
      aoe: 0,
      attackAngle: Math.PI,
      windupTime: 0.1,
      recoveryTime: 0,          // dash = no recovery
      fieldEffect: 'ignite',
      vfx: { cast: 'cm_firespin', hit: 'fz_fireball' },
    },
    {
      name: '화염 폭풍',
      type: 'damage',
      cooldown: 8,
      initialCooldown: 4,
      damage: 30,
      range: 3,
      stunDuration: 0.5,
      aoe: 4,
      windupTime: 0.12,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.3,
      fieldEffect: 'ignite',
      vfx: { cast: 'cm_fire', hit: 'cm_firespin', scale: 1.3 },
    },
    {
      name: '열풍 베기',
      type: 'damage',
      cooldown: 3,
      initialCooldown: 0,
      damage: 20,
      range: 3,
      stunDuration: 0,
      aoe: 2,
      attackAngle: Math.PI * 0.6,
      windupTime: 0.15,
      recoveryTime: 0.2,
      vfx: { hit: 'cm_flamelash' },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '불사조',
    icon: '🔥',
    castTime: 0.5,
    color: '#FF4400',
    screenColor: 'rgba(255,68,0,0.4)',
    radius: 8,
    damage: 40,
    stunDuration: 1.0,
    effects: {
      burn: 4.0,
    },
    vfx: { cast: 'cm_fire', hit: 'fz_explosion', scale: 1.5 },
  },
};

export default blaze;
