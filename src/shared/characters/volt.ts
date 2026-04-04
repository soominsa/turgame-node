/**
 * 볼트 — 번개 스나이퍼
 * 역할: 원딜 (장거리 전기)
 *
 * 물에 젖은 적에게 1.5배 데미지(도체 감지), 스킬 3회 적중마다 체인 기본공격(과충전).
 * 체인 라이트닝으로 연쇄 타격, 전자기장으로 electric 필드 설치.
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
  desc: '번개 저격, 감전 확산, 연쇄',
  color: '#DDCC44',
  colorAlt: '#AAAA22',

  // ── 기본 스탯 ──
  hp: 130,
  speed: 4.0,
  size: 0.4,

  // ── 기본 공격 ──
  attackDamage: 24,
  attackSpeed: 0.9,
  attackRange: 7,

  // ── 패시브 ──
  passives: [
    {
      name: '도체 감지',
      icon: '💧',
      desc: '물에 젖은 적(water/freeze 장판 통과 후 3초)에게 전기 데미지 1.5배. 젖은 적 위에 💧 표시.',
      trigger: { type: 'always' },
      effects: {
        damageMult: 1.5,
      },
      vfx: { hit: 'sp_lightning_burst' },
    },
    {
      name: '과충전',
      icon: '🔋',
      desc: '스킬 3회 적중마다 다음 기본공격이 체인 라이트닝으로 변환 — 주변 2명에게 연쇄 (50% 데미지).',
      trigger: { type: 'on_skill_hit', stacks: 3 },
      effects: {
        chainAttack: { targets: 2, damageRatio: 0.5 },
      },
      vfx: { hit: 'sp_lightning_strike' },
    },
  ],

  // ── 스킬 ──
  skills: [
    {
      name: '번개 화살',
      type: 'damage',
      cooldown: 2,
      initialCooldown: 0,
      damage: 50,
      range: 8,
      stunDuration: 0.3,
      aoe: 0,
      projectileSpeed: 30,
      tracking: 'loose',
      windupTime: 0.18,
      recoveryTime: 0.12,
      vfx: { cast: 'sp_lightning_strike', hit: 'sp_lightning_burst', scale: 1.2 },
    },
    {
      name: '전자기장',
      type: 'cc',
      cooldown: 7,
      initialCooldown: 3,
      damage: 28,
      range: 7,
      stunDuration: 0.5,
      aoe: 3,
      windupTime: 0.2,
      recoveryTime: 0,
      telegraphDelay: 0.5,
      shock: 2.5,              // 감전 2.5초 (주기적 미니스턴 + 이속감소 + DoT)
      fieldEffect: 'electric',
      vfx: { cast: 'sp_lightning_strike', hit: 'sp_lightning_burst', scale: 1.5 },
    },
    {
      name: '체인 라이트닝',
      type: 'damage',
      cooldown: 8,
      initialCooldown: 4,
      damage: 40,
      range: 8,
      stunDuration: 0.3,
      aoe: 0,
      projectileSpeed: 35,
      tracking: 'loose',
      windupTime: 0.2,
      recoveryTime: 0.15,
      shock: 1.5,              // 감전 1.5초
      // 적 적중 시 인접 2명에게 연쇄 (60% 데미지). 물 위 적에게는 연쇄 범위 2배
      vfx: { cast: 'sp_lightning_burst', hit: 'spe_ltn_burst1', scale: 1.3 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '뇌신의 심판',
    icon: '⚡',
    castTime: 0.8,
    color: '#FFEE44',
    screenColor: 'rgba(255,238,68,0.4)',
    radius: 7,
    damage: 45,
    stunDuration: 2.0,
    vfx: { cast: 'sp_lightning_strike', hit: 'sp_lightning_burst', scale: 2.0 },
  },
};

export default volt;
