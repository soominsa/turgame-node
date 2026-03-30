/**
 * 루미나 — 빛의 연쇄 암살자
 * 역할: 암살 (고속 근접)
 *
 * 그림자 도약으로 적 뒤를 잡고 백어택(1.4배), 킬 시 이속+회복으로 연쇄 암살.
 * 섬광으로 순간 폭딜, 섬광탄으로 범위 스턴. 궁극기로 시간 정지.
 */

import type { CharSheet } from './char-sheet.js';

const lumina: CharSheet = {
  // ── 기본 정보 ──
  id: 'lumina',
  name: '루미나',
  role: '암살',
  combatRole: 'melee',
  element: 'nature',
  icon: '⚔',
  desc: '텔레포트 암살, 백어택, 연쇄 킬',
  color: '#FFCC44',
  colorAlt: '#CCAA22',

  // ── 기본 스탯 ──
  hp: 180,
  speed: 6.0,
  size: 0.4,

  // ── 기본 공격 ──
  attackDamage: 25,
  attackSpeed: 1.8,
  attackRange: 2.5,

  // ── 패시브 ──
  passives: [
    {
      name: '암살자의 혈기',
      icon: '💀',
      desc: '킬/어시스트 시 3초간 이속 40%↑ + HP 20 회복. 연쇄 킬 시 효과 갱신.',
      trigger: { type: 'on_kill' },
      effects: {
        speedMult: 1.4,
        hpRegen: 20,    // 즉시 회복
        duration: 3,
      },
      vfx: { cast: 'cm_brightfire' },
    },
    {
      name: '그림자 접근',
      icon: '🗡️',
      desc: '적 뒤쪽(180도)에서 첫 공격 시 데미지 1.4배 + 0.3초 추가 스턴.',
      trigger: { type: 'backstab' },
      effects: {
        damageMult: 1.4,
        extraStun: 0.3,
      },
      vfx: { hit: 'pm_dark' },
    },
  ],

  // ── 스킬 ──
  skills: [
    {
      name: '섬광',
      type: 'damage',
      cooldown: 3,
      initialCooldown: 0,
      damage: 50,
      range: 4,
      stunDuration: 0.8,
      aoe: 0,
      attackAngle: Math.PI * 0.4,
      windupTime: 0.1,
      recoveryTime: 0,
      vfx: { cast: 'cm_brightfire', hit: 'cm_magichit' },
    },
    {
      name: '그림자 도약',
      type: 'mobility',
      cooldown: 5,
      initialCooldown: 1,
      damage: 0,
      range: 6,
      stunDuration: 0,
      aoe: 0,
      windupTime: 0.05,
      recoveryTime: 0.1,
      teleport: { stealthDuration: 0.5 },
      vfx: { cast: 'pm_dark', hit: 'spe_smoke' },
    },
    {
      name: '섬광탄',
      type: 'cc',
      cooldown: 8,
      initialCooldown: 4,
      damage: 15,
      range: 8,
      stunDuration: 2.5,
      aoe: 4,
      windupTime: 0.12,
      recoveryTime: 0,
      telegraphDelay: 0.4,
      vfx: { cast: 'cm_brightfire', hit: 'pm_dark', scale: 1.2 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '시간 정지',
    icon: '⏳',
    castTime: 0.1,
    color: '#FFDD44',
    screenColor: 'rgba(255,221,68,0.45)',
    radius: 10,
    damage: 35,
    stunDuration: 3.0,
    vfx: { cast: 'cm_magicspell', hit: 'cm_flamelash', scale: 1.5 },
  },
};

export default lumina;
