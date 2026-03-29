/**
 * 프로스트 — 얼음의 기사
 * 역할: 탱커 (얼음)
 *
 * 얼음 갑옷으로 버티며 적을 둔화/빙결시키는 탱커.
 * 빙벽으로 전선 사수, 얼음 돌진으로 진입.
 */

import type { CharSheet } from './char-sheet.js';

const frost: CharSheet = {
  // ── 기본 정보 ──
  id: 'frost',
  name: '프로스트',
  role: '탱커',
  combatRole: 'tank',
  element: 'water',
  icon: '❄️',
  desc: '얼음 기사, 빙결, 둔화',
  color: '#88CCFF',
  colorAlt: '#5599CC',

  // ── 기본 스탯 ──
  hp: 210,
  speed: 3.8,
  size: 0.65,

  // ── 기본 공격 ──
  attackDamage: 8,
  attackSpeed: 0.6,
  attackRange: 1.8,

  // ── 스킬 ──
  skills: [
    {
      name: '얼음 돌진',
      type: 'damage',
      cooldown: 8,
      initialCooldown: 3,
      damage: 18,
      range: 5,
      stunDuration: 0.8,
      aoe: 0,
      attackAngle: Math.PI,
      windupTime: 0.15,
      recoveryTime: 0,          // dash = no recovery
      fieldEffect: 'freeze',
      vfx: { cast: 'cm_freezing', hit: 'sp_impact_frost' },
    },
    {
      name: '빙결 파동',
      type: 'cc',
      cooldown: 6,
      initialCooldown: 2,
      damage: 18,
      range: 4,
      stunDuration: 1.5,
      aoe: 5,
      windupTime: 0.2,
      recoveryTime: 0,          // telegraph = no recovery
      fieldEffect: 'freeze',
      telegraphDelay: 0.3,
      vfx: { cast: 'cm_bluefire', hit: 'cm_freezing', scale: 1.5 },
    },
    {
      name: '서리 투척',
      type: 'damage',
      cooldown: 5,
      initialCooldown: 1,
      damage: 18,
      range: 8,
      stunDuration: 0.5,
      aoe: 0,
      projectileSpeed: 16,
      tracking: 'none',
      windupTime: 0.2,
      recoveryTime: 0.15,
      fieldEffect: 'freeze',
      vfx: { hit: 'cm_freezing' },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '절대영도',
    icon: '❄️',
    castTime: 1.2,
    color: '#88CCFF',
    screenColor: 'rgba(136,204,255,0.4)',
    radius: 8,
    damage: 30,
    stunDuration: 3.0,
    vfx: { cast: 'cm_freezing', hit: 'cm_bluefire', scale: 2.0 },
  },
};

export default frost;
