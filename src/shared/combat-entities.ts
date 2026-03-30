import type { ElementType, FieldEffectType, PassiveSheet } from './characters/char-sheet.js';

export interface Entity {
  id: string;
  name: string;
  team: 'A' | 'B';
  role: 'ranged' | 'melee' | 'tank' | 'support';
  element: ElementType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  hp: number;
  maxHp: number;
  attackDamage: number;
  attackSpeed: number;
  attackRange: number;
  attackCooldown: number;
  skills: Skill[];
  passives: PassiveSheet[];
  color: string;
  size: number;
  stunTimer: number;
  burnTimer: number;
  facingAngle: number;
  // 대쉬(돌진) 상태
  dashing: boolean;
  dashTarget: { x: number; y: number } | null;
  dashSpeed: number;
  dashDamage: number;
  dashStun: number;
  dashSkillName: string;
  dead: boolean;
  respawnTimer: number;
  spawnX: number;
  spawnY: number;
  invincibleTimer: number;
  kills: number;
  deaths: number;
  assists: number;
  captures: number;
  defends: number;
  damageDealt: number;
  healingDone: number;
  damageTaken: number;
  // 궁극기
  ultCharge: number;      // 0~100
  ultReady: boolean;      // 100 도달 시 true
  ultCasting: number;     // >0이면 캐스팅 중 (남은 시간)
  // 스킬 선딜/후딜
  skillCasting: number;        // >0이면 선딜 중 (남은 시간)
  skillRecovery: number;       // >0이면 후딜 중 (남은 시간)
  pendingSkill: { skill: Skill; target: Entity } | null;  // 선딜 완료 후 발동할 스킬
  // 아이템 버프
  buffs: Array<{ type: 'speed' | 'damage' | 'defense'; remaining: number; multiplier: number }>;
  // 원소 속성 버프/디버프 상태
  elemBuff: number;          // 버프 남은 시간 (0=없음)
  elemDebuff: number;        // 디버프 남은 시간 (0=없음)
  elemChargeTimer: number;   // 충전 중 타이머
  elemChargeType: 'buff' | 'debuff' | null;  // 현재 충전 중인 타입
}

export interface Skill {
  name: string;
  cooldown: number;
  remaining: number;
  damage: number;
  range: number;
  stunDuration: number;
  aoe: number;
  type: 'damage' | 'heal' | 'field' | 'cc' | 'buff' | 'trap' | 'mobility';
  fieldEffect?: FieldEffectType;
  // 투사체 속성 (undefined = 즉시 적중)
  projectileSpeed?: number;   // 타일/초. 설정 시 투사체로 발사
  tracking?: 'none' | 'loose'; // 유도 방식
  telegraphDelay?: number;     // AOE 텔레그래프 딜레이 (초). 설정 시 바닥 표시 후 폭발
  // 근접 공격 판정
  attackAngle?: number;        // 공격 범위 각도 (라디안). 넓을수록 방향 관대. 미설정 시 Math.PI (180도)
  windupTime?: number;         // 선딜 (초). 스킬 시전 시작 ~ 실제 효과 적용까지 대기 시간
  recoveryTime?: number;       // 후딜 (초). 스킬 효과 적용 후 ~ 다음 행동 가능까지 경직 시간
  // 추가 CC 효과
  dot?: { damage: number; duration: number };      // 독/화상 DoT
  slow?: { ratio: number; duration: number };      // 슬로우
  root?: number;               // 속박 지속 (이동불가, 스킬가능)
  knockup?: number;            // 넉업 지속 (공중, 피격뎀 20%↑)
  // 트랩/설치물
  trap?: { count: number; lifetime: number; hidden?: boolean };
  // 텔레포트/도약
  teleport?: { stealthDuration?: number };
  // 소환물 (빙벽 등)
  summon?: { hp: number; duration: number; blocksMovement: boolean };
  // 필드 소비 증폭 (블레이즈 화염 선회)
  consumeField?: { fieldEffect: FieldEffectType; bonusDamage: number };
  buffEffects?: {
    speedMult?: number;
    damageMult?: number;
    defenseMult?: number;
    duration: number;
  };
  // VFX 설정 (캐릭터 시트에서 전달)
  vfx?: {
    cast?: string;        // 시전 이펙트
    projectile?: string;  // 투사체 이펙트
    hit?: string;         // 적중 이펙트
    scale?: number;       // 스케일 배율
  };
}

// ─── 하위 호환 팩토리 함수 ───
// 실제 데이터는 shared/characters/*.ts에 정의됨.
// 기존 코드에서 import { createTerra } 하는 곳을 위한 래퍼.

import { SHEETS, createEntity } from './characters/index.js';

function makeFactory(id: string) {
  const sheet = SHEETS.find(s => s.id === id)!;
  return (team: 'A' | 'B', x: number, y: number): Entity => createEntity(sheet, team, x, y);
}

export const createTerra = makeFactory('terra');
export const createSylvan = makeFactory('sylvan');
export const createGrovekeeper = makeFactory('grove');
export const createBreaker = makeFactory('breaker');
export const createLumina = makeFactory('lumina');
export const createAeris = makeFactory('aeris');
export const createStone = makeFactory('stone');
export const createTide = makeFactory('tide');
