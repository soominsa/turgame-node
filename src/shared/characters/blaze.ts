/**
 * 블레이즈 — 화염의 광전사
 * 역할: 근딜 (화염 근접)
 *
 * 이동 경로에 ignite 흔적(불꽃 잔상), HP 30% 이하에서 광전사(열폭주).
 * 화염 돌진으로 진입, 화염 선회로 ignite 소비 폭발. 궁극기로 불사조 화상.
 */

import type { CharSheet } from './char-sheet.js';

const blaze: CharSheet = {
  // ── 기본 정보 ──
  id: 'blaze',
  name: '블레이즈',
  role: '근딜',
  combatRole: 'melee',
  element: 'fire',
  icon: '🔥',
  desc: '불꽃 잔상, 화염 폭주, 돌진',
  color: '#FF6622',
  colorAlt: '#CC4400',

  // ── 기본 스탯 ──
  hp: 150,
  speed: 5.2,
  size: 0.45,

  // ── 기본 공격 ──
  attackDamage: 20,
  attackSpeed: 1.5,
  attackRange: 2.0,

  // ── 패시브 ──
  passives: [
    {
      name: '불꽃 잔상',
      icon: '🔥',
      desc: '이동 경로에 ignite 흔적 (1초, 3뎀/초). 대시 시 3초로 강화. 연계 ②③ 트리거 가능.',
      trigger: { type: 'always' },
      effects: {
        trail: { fieldEffect: 'ignite', duration: 1, damage: 3 },
      },
      vfx: { cast: 'cm_firespin' },
    },
    {
      name: '열폭주',
      icon: '💢',
      desc: 'HP 30% 이하 시 공격 데미지 40%↑ + 이속 20%↑. 눈이 빨갛게 빛남.',
      trigger: { type: 'low_hp', threshold: 0.3 },
      effects: {
        damageMult: 1.4,
        speedMult: 1.2,
      },
      vfx: { cast: 'cm_fire' },
    },
  ],

  // ── 스킬 ──
  skills: [
    {
      name: '화염 돌진',
      type: 'damage',
      cooldown: 8,
      initialCooldown: 3,
      damage: 25,
      range: 5,
      stunDuration: 0.3,
      aoe: 0,
      attackAngle: Math.PI,
      windupTime: 0.1,
      recoveryTime: 0,
      fieldEffect: 'ignite',
      vfx: { cast: 'cm_firespin', hit: 'fz_fireball' },
    },
    {
      name: '화염 선회',
      type: 'damage',
      cooldown: 8,
      initialCooldown: 4,
      damage: 30,
      range: 3,
      stunDuration: 0.5,
      aoe: 4,
      windupTime: 0.12,
      recoveryTime: 0,
      telegraphDelay: 0.3,
      fieldEffect: 'ignite',
      consumeField: { fieldEffect: 'ignite', bonusDamage: 5 },  // 소비 타일당 +5뎀
      vfx: { cast: 'cm_firespin', hit: 'fz_explosion', scale: 1.3 },
    },
    {
      name: '열풍 베기',
      type: 'damage',
      cooldown: 3,
      initialCooldown: 0,
      damage: 20,
      range: 3,
      stunDuration: 0,
      aoe: 2,
      attackAngle: Math.PI * 0.6,
      windupTime: 0.15,
      recoveryTime: 0.2,
      vfx: { hit: 'cm_flamelash' },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '불사조',
    icon: '🔥',
    castTime: 0.5,
    color: '#FF4400',
    screenColor: 'rgba(255,68,0,0.4)',
    radius: 8,
    damage: 40,
    stunDuration: 1.0,
    effects: {
      burn: 4.0,
    },
    vfx: { cast: 'cm_fire', hit: 'fz_explosion', scale: 1.5 },
  },
};

export default blaze;
