/**
 * 에리스 — 바람의 마법사
 * 역할: 지원 (원거리 마법)
 *
 * 돌풍으로 견제, 가속으로 아군 버프, 진공으로 적을 모아 제압.
 * 궁극기 태풍의 눈으로 적을 흡인 후 폭발.
 */

import type { CharSheet } from './char-sheet.js';

const aeris: CharSheet = {
  // ── 기본 정보 ──
  id: 'aeris',
  name: '에리스',
  role: '지원',
  combatRole: 'support',
  element: 'fire',
  icon: '🌪️',
  desc: '진공, 산성비, 가속',
  color: '#88CCAA',
  colorAlt: '#6699BB',

  // ── 기본 스탯 ──
  hp: 140,
  speed: 3.8,
  size: 0.4,

  // ── 기본 공격 ──
  attackDamage: 5,
  attackSpeed: 0.6,
  attackRange: 10,

  // ── 패시브 ──
  passives: [
    {
      name: '순풍/역풍',
      icon: '💨',
      desc: '마지막 스킬 방향 = 바람 방향. 순풍 아군 이속 15%↑, 역풍 적 이속 10%↓, 투사체 속도 ±20%.',
      trigger: { type: 'directional' },
      effects: {
        allySpeedMult: 1.15,
        enemySpeedMult: 0.9,
      },
      vfx: { cast: 'pm_wind' },
    },
  ],

  // ── 스킬 ──
  skills: [
    {
      name: '돌풍',
      type: 'damage',
      cooldown: 4,
      initialCooldown: 0,
      damage: 15,
      range: 10,
      stunDuration: 0.4,
      aoe: 3,
      blind: 1.5,             // 시야차단 1.5초 (시야축소 + 35% 빗나감)
      projectileSpeed: 20,
      tracking: 'none',
      windupTime: 0.12,
      recoveryTime: 0.12,
      vfx: { hit: 'fz_wind' },
    },
    {
      name: '가속',
      type: 'buff',
      cooldown: 7,
      initialCooldown: 2,
      damage: 0,
      range: 12,
      stunDuration: 0,
      aoe: 0,
      windupTime: 0.05,
      recoveryTime: 0.1,
      buffEffects: {
        speedMult: 1.6,        // 이속 60% 증가
        damageMult: 1.5,       // 공격력 50% 증가
        duration: 12,          // 12초 지속
      },
      vfx: { cast: 'pm_wind' },
    },
    {
      name: '보호 바람',
      type: 'heal',
      cooldown: 8,
      initialCooldown: 4,
      damage: -50,
      range: 10,
      stunDuration: 0,
      aoe: 5,
      windupTime: 0.08,
      recoveryTime: 0.12,
      buffEffects: {
        defenseMult: 0.5,      // 피해 50% 감소
        duration: 12,          // 12초 지속
      },
      vfx: { cast: 'cm_shield', hit: 'pm_wind' },
    },
    {
      name: '진공',
      type: 'cc',
      cooldown: 14,
      initialCooldown: 8,
      damage: 22,
      range: 8,
      stunDuration: 2.5,
      aoe: 5,
      windupTime: 0.12,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.6,
      vfx: { hit: 'cm_vortex' },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '태풍의 눈',
    icon: '🌪️',
    castTime: 1.0,
    color: '#88CCEE',
    screenColor: 'rgba(136,204,238,0.35)',
    radius: 12,
    damage: 40,
    stunDuration: 2.0,
    effects: {
      pull: 5,
      blind: 2.5,             // 시야차단 2.5초
    },
    vfx: { cast: 'cm_vortex', hit: 'fz_tornado', scale: 1.5 },
  },
};

export default aeris;
