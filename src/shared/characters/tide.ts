/**
 * 타이드 — 바다의 지배자
 * 역할: 제어 (원거리 마법)
 *
 * 파도/빙결로 적을 묶고, 해류로 아군을 회복.
 * 쓰나미로 광역 피해+스턴. 궁극기 대해일로 초광역 제압.
 */

import type { CharSheet } from './char-sheet.js';

const tide: CharSheet = {
  // ── 기본 정보 ──
  id: 'tide',
  name: '타이드',
  role: '제어',
  combatRole: 'support',
  element: 'water',
  icon: '🌊',
  desc: '해일, 빙결, 안개',
  color: '#4488DD',
  colorAlt: '#2266AA',

  // ── 기본 스탯 ──
  hp: 145,
  speed: 3.5,
  size: 0.45,

  // ── 기본 공격 ──
  attackDamage: 5,
  attackSpeed: 0.5,
  attackRange: 9,

  // ── 패시브 ──
  passives: [
    {
      name: '조류 지배',
      icon: '🌀',
      desc: 'water 장판 위에서 쿨타임 20% 감소. 물 위 아군 이속 10%↑, 적 이속 15%↓.',
      trigger: { type: 'on_field', fieldTypes: ['water'] },
      effects: {
        cooldownMult: 0.8,
        allySpeedMult: 1.1,
        enemySpeedMult: 0.85,
      },
      vfx: { cast: 'cm_bubbles' },
    },
  ],

  // ── 스킬 ──
  skills: [
    {
      name: '파도',
      type: 'damage',
      cooldown: 4,
      initialCooldown: 0,
      damage: 18,
      range: 10,
      stunDuration: 0.5,
      aoe: 4,
      fieldEffect: 'water',
      projectileSpeed: 16,
      tracking: 'loose',
      windupTime: 0.12,
      recoveryTime: 0.12,
      vfx: { hit: 'fz_water' },
    },
    {
      name: '빙결',
      type: 'cc',
      cooldown: 8,
      initialCooldown: 3,
      damage: 12,
      range: 10,
      stunDuration: 0,
      aoe: 3,
      freeze: 2.0,            // 빙결 2초 (행동불가 + 피해30%감소)
      windupTime: 0.12,
      recoveryTime: 0,          // telegraph = no recovery
      fieldEffect: 'freeze',
      telegraphDelay: 0.5,
      vfx: { hit: 'cm_freezing' },
    },
    {
      name: '해류',
      type: 'heal',
      cooldown: 6,
      initialCooldown: 2,
      damage: -30,
      range: 8,
      stunDuration: 0,
      aoe: 0,
      windupTime: 0.08,
      recoveryTime: 0.12,
      fieldEffect: 'water',
      vfx: { cast: 'pm_heal', hit: 'cm_bubbles' },
    },
    {
      name: '쓰나미',
      type: 'damage',
      cooldown: 35,
      initialCooldown: 18,
      damage: 40,
      range: 12,
      stunDuration: 3,
      aoe: 8,
      fieldEffect: 'water',
      windupTime: 0.12,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 1.0,
      vfx: { hit: 'fz_water_geyser', scale: 1.3 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '대해일',
    icon: '🌊',
    castTime: 1.2,
    color: '#4488DD',
    screenColor: 'rgba(68,136,221,0.4)',
    radius: 12,
    damage: 35,
    stunDuration: 2.5,
    vfx: { cast: 'fz_water_geyser', hit: 'cm_freezing', scale: 2.0 },
  },
};

export default tide;
