/**
 * 테라 — 대지의 수호자
 * 역할: 탱커 (근접)
 *
 * 높은 HP와 돌진으로 전선을 돌파하는 근접 탱커.
 * 강타로 주변 적을 한꺼번에 제압. 궁극기로 전방 적을 넉백.
 */

import type { CharSheet } from './char-sheet.js';

const terra: CharSheet = {
  // ── 기본 정보 ──
  id: 'terra',
  name: '테라',
  role: '탱커',
  combatRole: 'tank',
  element: 'earth',
  icon: '🛡️',
  desc: 'HP높음, 근접, 흙',
  color: '#88AA44',
  colorAlt: '#AA6622',

  // ── 기본 스탯 ──
  hp: 200,
  speed: 4.0,
  size: 0.6,

  // ── 기본 공격 ──
  attackDamage: 8,
  attackSpeed: 0.7,
  attackRange: 1.8,

  // ── 스킬 ──
  skills: [
    {
      name: '돌진',
      type: 'damage',
      cooldown: 10,
      initialCooldown: 3,
      damage: 20,
      range: 5,
      stunDuration: 0.4,
      aoe: 0,
      attackAngle: Math.PI,
      windupTime: 0.15,
      recoveryTime: 0,          // dash = no recovery
      vfx: { hit: 'fz_rocks' },
    },
    {
      name: '강타',
      type: 'damage',
      cooldown: 10,
      initialCooldown: 5,
      damage: 18,
      range: 2,
      stunDuration: 0.2,
      aoe: 3,
      attackAngle: Math.PI * 0.7,
      windupTime: 0.25,
      recoveryTime: 0.35,
      vfx: { hit: 'fz_earth_spike' },
    },
    {
      name: '대지 방패',
      type: 'cc',
      cooldown: 12,
      initialCooldown: 6,
      damage: 15,
      range: 4,
      stunDuration: 1.5,
      aoe: 4,
      windupTime: 0.2,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.4,
      fieldEffect: 'mud',
      vfx: { cast: 'fz_rocks', hit: 'fz_earth_spike', scale: 1.3 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '대지의 분노',
    icon: '🌍',
    castTime: 0.3,
    color: '#CC8844',
    screenColor: 'rgba(139,105,20,0.4)',
    radius: 8,
    damage: 35,
    stunDuration: 1.0,
    effects: {
      frontAngle: Math.PI / 3,   // 전방 120도
      knockback: 3,
    },
    vfx: { cast: 'fz_earth_spike', hit: 'fz_explosion', scale: 1.5 },
  },
};

export default terra;
