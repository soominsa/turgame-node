/**
 * 실반 — 숲의 저격수
 * 역할: 원딜 (원거리)
 *
 * 독안개로 grow 장판을 깔고 그 위에 은신하여 기습하는 자연의 사냥꾼.
 * 맹독 화살로 독 DoT, 덩굴 화살로 연사 딜링. 궁극기로 광역 독안개.
 */

import type { CharSheet } from './char-sheet.js';

const sylvan: CharSheet = {
  // ── 기본 정보 ──
  id: 'sylvan',
  name: '실반',
  role: '원딜',
  combatRole: 'ranged',
  element: 'nature',
  icon: '🏹',
  desc: '은신 저격, 독, 덩굴',
  color: '#44AA44',
  colorAlt: '#228822',

  // ── 기본 스탯 ──
  hp: 130,
  speed: 4.5,
  size: 0.5,

  // ── 기본 공격 ──
  attackDamage: 20,
  attackSpeed: 1.3,
  attackRange: 9,

  // ── 패시브 ──
  passives: [
    {
      name: '위장술',
      icon: '🌿',
      desc: 'grow 타일 위에서 2초 정지 시 은신. 은신 중 다음 공격 데미지 1.5배 (기습). 은신 해제 후 6초 쿨.',
      trigger: { type: 'stationary', duration: 2 },
      effects: {
        stealth: true,
        damageMult: 1.5,
        cooldown: 6,
      },
      vfx: { cast: 'pm_poison' },
    },
  ],

  // ── 스킬 ──
  skills: [
    {
      name: '덩굴 화살',
      type: 'damage',
      cooldown: 2,
      initialCooldown: 0,
      damage: 30,
      range: 10,
      stunDuration: 0,
      aoe: 0,
      projectileSpeed: 20,
      tracking: 'loose',
      windupTime: 0.18,
      recoveryTime: 0.12,
      vfx: { hit: 'pm_earth1' },
    },
    {
      name: '맹독 화살',
      type: 'cc',
      cooldown: 6,
      initialCooldown: 3,
      damage: 8,
      range: 10,
      stunDuration: 0,
      aoe: 0,
      projectileSpeed: 15,
      tracking: 'loose',
      windupTime: 0.18,
      recoveryTime: 0.12,
      dot: { damage: 8, duration: 3 },     // 3초간 초당 8뎀 (합계 24)
      vfx: { cast: 'pm_poison', hit: 'sp_spell_poison' },
    },
    {
      name: '독안개 화살',
      type: 'damage',
      cooldown: 5,
      initialCooldown: 2,
      damage: 35,
      range: 10,
      stunDuration: 0.3,
      aoe: 3,
      windupTime: 0.2,
      recoveryTime: 0,
      telegraphDelay: 0.5,
      fieldEffect: 'grow',
      vfx: { cast: 'pm_poison', hit: 'cm_vortex', scale: 1.3 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '독안개',
    icon: '☠️',
    castTime: 0.5,
    color: '#44AA44',
    screenColor: 'rgba(68,170,68,0.35)',
    radius: 9,
    damage: 45,
    stunDuration: 0.8,
    vfx: { cast: 'pm_poison', hit: 'cm_vortex', scale: 1.5 },
  },
};

export default sylvan;
