/**
 * 프로스트 — 거점을 얼음 요새로 만드는 동장군
 * 역할: 탱커 (얼음)
 *
 * 주변 타일이 자동으로 freeze(동토의 영역), 빙벽으로 진입로 차단.
 * 얼음 돌진으로 진입, 빙결 파동으로 광역 CC. 궁극기로 절대영도.
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
  desc: '자동 동결, 빙벽, 둔화',
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

  // ── 패시브 ──
  passives: [
    {
      name: '동토의 영역',
      icon: '🧊',
      desc: '반경 2칸 타일이 3초에 1칸씩 freeze로 변환. freeze 위에서 방어력 25%↑.',
      trigger: { type: 'aura', radius: 2 },
      effects: {
        fieldGenerate: { fieldEffect: 'freeze', radius: 2, interval: 3 },
        defenseMult: 0.75,   // freeze 위에서 25% 피해 감소
      },
      vfx: { cast: 'cm_freezing' },
    },
  ],

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
      recoveryTime: 0,
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
      stunDuration: 0,
      aoe: 5,
      windupTime: 0.2,
      recoveryTime: 0,
      freeze: 2.0,             // 빙결 2초 (행동불가 + 피해30%감소 + 해빙 슬로우)
      fieldEffect: 'freeze',
      telegraphDelay: 0.3,
      vfx: { cast: 'cm_bluefire', hit: 'cm_freezing', scale: 1.5 },
    },
    {
      name: '빙벽',
      type: 'cc',
      cooldown: 5,
      initialCooldown: 1,
      damage: 0,
      range: 6,
      stunDuration: 0,
      aoe: 0,
      windupTime: 0.2,
      recoveryTime: 0.15,
      fieldEffect: 'freeze',
      summon: { hp: 60, duration: 5, blocksMovement: true },   // 빙벽: 내구도 60, 5초, 이동 차단
      vfx: { cast: 'cm_freezing', hit: 'cm_bluefire', scale: 1.2 },
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
    stunDuration: 1.0,
    effects: {
      freeze: 3.0,             // 빙결 3초
    },
    vfx: { cast: 'cm_freezing', hit: 'cm_bluefire', scale: 2.0 },
  },
};

export default frost;
