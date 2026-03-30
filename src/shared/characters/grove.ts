/**
 * 그로브 — 닿는 곳마다 생명이 자라는 숲의 어머니
 * 역할: 힐러 (원거리)
 *
 * 힐 시 grow 타일 자동 생성(생명의 순환), grow 위 힐 대상 추가 회복.
 * 생명의 씨앗 설치로 지연 힐+grow. 궁극기로 아군 무적+대량 회복.
 */

import type { CharSheet } from './char-sheet.js';

const grove: CharSheet = {
  // ── 기본 정보 ──
  id: 'grove',
  name: '그로브',
  role: '힐러',
  combatRole: 'support',
  element: 'water',
  icon: '💚',
  desc: '힐+grow 생성, 씨앗, 빙결',
  color: '#22AAAA',
  colorAlt: '#118888',

  // ── 기본 스탯 ──
  hp: 150,
  speed: 3.8,
  size: 0.45,

  // ── 기본 공격 ──
  attackDamage: 5,
  attackSpeed: 0.5,
  attackRange: 9,

  // ── 패시브 ──
  passives: [
    {
      name: '생명의 순환',
      icon: '🌱',
      desc: '힐 시 대상 발밑에 grow 타일 생성 (3초). grow 위 힐 대상은 추가 HP 15 회복.',
      trigger: { type: 'always' },
      effects: {
        fieldGenerate: { fieldEffect: 'grow', radius: 0, interval: 0 },  // 힐 시 자동
        healMult: 1.0,   // grow 위 대상 추가 15 (엔진에서 처리)
      },
      vfx: { cast: 'pm_heal', hit: 'pm_earth1' },
    },
  ],

  // ── 스킬 ──
  skills: [
    {
      name: '치유',
      type: 'heal',
      cooldown: 5,
      initialCooldown: 0,
      damage: -40,
      range: 8,
      stunDuration: 0,
      aoe: 0,
      windupTime: 0.08,
      recoveryTime: 0.12,
      fieldEffect: 'water',
      vfx: { cast: 'pm_heal', hit: 'cm_casting' },
    },
    {
      name: '빙결',
      type: 'cc',
      cooldown: 7,
      initialCooldown: 3,
      damage: 15,
      range: 10,
      stunDuration: 1.5,
      aoe: 3,
      windupTime: 0.12,
      recoveryTime: 0,
      fieldEffect: 'freeze',
      telegraphDelay: 0.6,
      vfx: { hit: 'cm_freezing' },
    },
    {
      name: '생명의 씨앗',
      type: 'heal',
      cooldown: 5,
      initialCooldown: 0,
      damage: -25,            // 발아 시 범위 힐 25
      range: 8,
      stunDuration: 0,
      aoe: 3,
      windupTime: 0.12,
      recoveryTime: 0,
      telegraphDelay: 3.0,    // 3초 후 발아
      fieldEffect: 'grow',
      slow: { ratio: 0.3, duration: 1 },   // 적이 밟으면 슬로우
      vfx: { cast: 'pm_earth1', hit: 'pm_heal', scale: 1.2 },
    },
    {
      name: '대순환',
      type: 'heal',
      cooldown: 30,
      initialCooldown: 15,
      damage: -70,
      range: 15,
      stunDuration: 1.5,
      aoe: 8,
      windupTime: 0.08,
      recoveryTime: 0,
      telegraphDelay: 0.8,
      vfx: { cast: 'cm_casting', hit: 'pm_heal', scale: 1.3 },
    },
  ],

  // ── 궁극기 ──
  ultimate: {
    name: '생명의 나무',
    icon: '🌳',
    castTime: 1.5,
    color: '#22AAAA',
    screenColor: 'rgba(34,170,170,0.35)',
    radius: 8,
    damage: 0,
    stunDuration: 0,
    effects: {
      allyHeal: 80,
      allyInvincible: 3.0,
    },
    vfx: { cast: 'cm_casting', hit: 'cm_bubbles', scale: 2.0 },
  },
};

export default grove;
