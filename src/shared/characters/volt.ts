/**
 * 볼트 — 번개의 저격수
 * 역할: 원딜 (장거리 마법)
 *
 * 느리지만 한 발이 아픈 장거리 저격형 원딜.
 * 번개 화살로 고피해 단일 타격, 감전으로 범위 CC.
 */

import type { CharSheet } from './char-sheet.js';

const volt: CharSheet = {
  // ── 기본 정보 ──
  id: 'volt',
  name: '볼트',
  role: '원딜',
  combatRole: 'ranged',
  element: 'earth',
  icon: '⚡',
  desc: '장거리 저격, 고피해 단발',
  color: '#DDCC44',
  colorAlt: '#AAAA22',

  // ── 기본 스탯 ──
  hp: 130,
  speed: 4.0,
  size: 0.4,

  // ── 기본 공격 ──
  attackDamage: 24,
  attackSpeed: 0.9,
  attackRange: 12,

  // ── 스킬 ──
  skills: [
    {
      name: '번개 화살',
      type: 'damage',
      cooldown: 2,
      initialCooldown: 0,
      damage: 50,
      range: 12,
      stunDuration: 0.3,
      aoe: 0,
      projectileSpeed: 30,
      tracking: 'loose',
      windupTime: 0.18,
      recoveryTime: 0.12,
      vfx: { cast: 'sp_lightning_strike', hit: 'sp_lightning_burst', scale: 1.2 },
    },
    {
      name: '감전',
      type: 'cc',
      cooldown: 7,
      initialCooldown: 3,
      damage: 28,
      range: 10,
      stunDuration: 1.5,
      aoe: 3,
      windupTime: 0.2,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.5,
      vfx: { cast: 'sp_lightning_strike', hit: 'sp_lightning_burst', scale: 1.5 },
    },
    {
      name: '과부하',
      type: 'damage',
      cooldown: 8,
      initialCooldown: 4,
      damage: 55,
      range: 14,
      stunDuration: 0.8,
      aoe: 0,
      projectileSpeed: 35,
      tracking: 'loose',
      windupTime: 0.2,
      recoveryTime: 0.15,
      vfx: { cast: 'sp_lightning_burst', hit: 'cm_magicspell', scale: 1.3 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '뇌신의 심판',
    icon: '⚡',
    castTime: 0.8,
    color: '#FFEE44',
    screenColor: 'rgba(255,238,68,0.4)',
    radius: 10,
    damage: 45,
    stunDuration: 2.0,
    vfx: { cast: 'sp_lightning_strike', hit: 'sp_lightning_burst', scale: 2.0 },
  },
};

export default volt;
