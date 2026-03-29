/**
 * 그로브 — 숲의 수호자
 * 역할: 힐러 (원거리)
 *
 * 아군을 치유하고 빙결/덩굴벽으로 적을 제어.
 * 대순환으로 광역 힐+스턴. 궁극기로 아군 대규모 회복+무적.
 */

import type { CharSheet } from './char-sheet.js';

const grove: CharSheet = {
  // ── 기본 정보 ──
  id: 'grove',
  name: '그로브',
  role: '힐러',
  combatRole: 'support',
  element: 'water',
  icon: '💚',
  desc: '힐, 빙결, 덩굴벽',
  color: '#22AAAA',
  colorAlt: '#118888',

  // ── 기본 스탯 ──
  hp: 150,
  speed: 3.8,
  size: 0.45,

  // ── 기본 공격 ──
  attackDamage: 5,
  attackSpeed: 0.5,
  attackRange: 9,

  // ── 스킬 ──
  skills: [
    {
      name: '치유',
      type: 'heal',
      cooldown: 5,
      initialCooldown: 0,
      damage: -40,
      range: 8,
      stunDuration: 0,
      aoe: 0,
      windupTime: 0.08,
      recoveryTime: 0.12,
      fieldEffect: 'water',
      vfx: { cast: 'pm_heal', hit: 'cm_casting' },
    },
    {
      name: '빙결',
      type: 'cc',
      cooldown: 7,
      initialCooldown: 3,
      damage: 15,
      range: 10,
      stunDuration: 1.5,
      aoe: 3,
      windupTime: 0.12,
      recoveryTime: 0,          // telegraph = no recovery
      fieldEffect: 'freeze',
      telegraphDelay: 0.6,
      vfx: { hit: 'cm_freezing' },
    },
    {
      name: '가시 덩굴',
      type: 'damage',
      cooldown: 5,
      initialCooldown: 0,
      damage: 10,
      range: 8,
      stunDuration: 0.5,
      aoe: 4,
      windupTime: 0.12,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.4,
      vfx: { hit: 'pm_earth2' },
    },
    {
      name: '대순환',
      type: 'heal',
      cooldown: 30,
      initialCooldown: 15,
      damage: -70,
      range: 15,
      stunDuration: 1.5,
      aoe: 8,
      windupTime: 0.08,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.8,
      vfx: { cast: 'cm_casting', hit: 'pm_heal', scale: 1.3 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '생명의 나무',
    icon: '🌳',
    castTime: 1.5,
    color: '#22AAAA',
    screenColor: 'rgba(34,170,170,0.35)',
    radius: 8,
    damage: 0,
    stunDuration: 0,
    effects: {
      allyHeal: 80,
      allyInvincible: 3.0,
    },
    vfx: { cast: 'cm_casting', hit: 'cm_bubbles', scale: 2.0 },
  },
};

export default grove;
