/**
 * 테라 — 돌진해서 지형을 바꾸는 개척 탱커
 * 역할: 탱커 (근접)
 *
 * 돌진 경로를 mud로 변환(지각 변동), 지각 들어올림으로 적을 넉업.
 * 대지 방패로 mud 장판 + CC. 궁극기로 전방 넉백.
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
  desc: '돌진 지형변환, 넉업, 흙',
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

  // ── 패시브 ──
  passives: [
    {
      name: '지각 변동',
      icon: '🌋',
      desc: '돌진 시 경로 타일을 mud로 변환 + 도착 지점 주변 1칸 미니 넉백.',
      trigger: { type: 'always' },
      effects: {
        trail: { fieldEffect: 'mud', duration: 8, damage: 0 },
      },
      vfx: { cast: 'fz_rocks', hit: 'fz_earth_spike' },
    },
  ],

  // ── 스킬 ──
  skills: [
    {
      name: '돌진',
      type: 'damage',
      cooldown: 8,              // 10→8초 조정
      initialCooldown: 3,
      damage: 20,
      range: 5,
      stunDuration: 0.4,
      aoe: 0,
      attackAngle: Math.PI,
      windupTime: 0.15,
      recoveryTime: 0,
      fieldEffect: 'mud',       // 패시브와 연동: 경로 mud화
      vfx: { hit: 'fz_rocks' },
    },
    {
      name: '지각 들어올림',
      type: 'cc',
      cooldown: 10,
      initialCooldown: 5,
      damage: 18,
      range: 2,
      stunDuration: 0,
      aoe: 3,
      attackAngle: Math.PI * 0.7,
      windupTime: 0.25,
      recoveryTime: 0.35,
      knockup: 0.8,             // 0.8초 넉업 (공중, 피격뎀 20%↑)
      vfx: { cast: 'fz_earth_spike', hit: 'fz_rocks', scale: 1.2 },
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
      recoveryTime: 0,
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
      frontAngle: Math.PI / 3,
      knockback: 3,
    },
    vfx: { cast: 'fz_earth_spike', hit: 'fz_explosion', scale: 1.5 },
  },
};

export default terra;
