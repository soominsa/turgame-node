/**
 * 바위 — 철벽의 수호자
 * 역할: 탱커 (근접)
 *
 * 최고 HP와 넓은 체급으로 전선 사수. 지진으로 광역 스턴,
 * 방벽으로 지형 생성. 궁극기로 아군 무적+적 넉백.
 */

import type { CharSheet } from './char-sheet.js';

const stone: CharSheet = {
  // ── 기본 정보 ──
  id: 'stone',
  name: '바위',
  role: '탱커',
  combatRole: 'tank',
  element: 'earth',
  icon: '🪨',
  desc: '최고HP, 지진, 방벽',
  color: '#889999',
  colorAlt: '#667777',

  // ── 기본 스탯 ──
  hp: 250,
  speed: 3.5,
  size: 0.7,

  // ── 기본 공격 ──
  attackDamage: 10,
  attackSpeed: 0.7,
  attackRange: 1.8,

  // ── 스킬 ──
  skills: [
    {
      name: '지진',
      type: 'cc',
      cooldown: 5,
      initialCooldown: 2,
      damage: 25,
      range: 4,
      stunDuration: 1.5,
      aoe: 5,
      windupTime: 0.2,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.3,
      vfx: { cast: 'fz_rocks', hit: 'fz_earth_spike' },
    },
    {
      name: '바위 투척',
      type: 'damage',
      cooldown: 7,
      initialCooldown: 3,
      damage: 25,
      range: 8,
      stunDuration: 0.5,
      aoe: 0,
      projectileSpeed: 14,
      tracking: 'loose',
      windupTime: 0.2,
      recoveryTime: 0.15,
      vfx: { hit: 'fz_rocks', scale: 1.2 },
    },
    {
      name: '대지 진동',
      type: 'cc',
      cooldown: 10,
      initialCooldown: 5,
      damage: 12,
      range: 5,
      stunDuration: 1.0,
      aoe: 6,
      windupTime: 0.2,
      recoveryTime: 0,          // telegraph = no recovery
      telegraphDelay: 0.5,
      fieldEffect: 'mud',
      vfx: { cast: 'fz_rocks', hit: 'fz_earth_spike', scale: 1.3 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '철벽 요새',
    icon: '🏰',
    castTime: 1.5,
    color: '#889999',
    screenColor: 'rgba(136,153,153,0.35)',
    radius: 6,
    damage: 0,               // 아군 전용 궁극기
    stunDuration: 0,
    effects: {
      allyHeal: 30,
      allyInvincible: 3.0,
      enemyDamage: 20,
      enemyStun: 1.5,
      enemyKnockback: 4,
    },
    vfx: { cast: 'cm_shield', hit: 'fz_earth_spike', scale: 1.5 },
  },
};

export default stone;
