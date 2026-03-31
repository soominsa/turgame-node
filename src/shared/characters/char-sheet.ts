/**
 * CharSheet — 캐릭터 시트 인터페이스
 *
 * 기획자가 캐릭터 파일 하나만 보고 모든 스탯/스킬/궁극기를 파악할 수 있도록
 * 설계된 데이터 구조. 새 캐릭터 추가 시 이 형식에 맞춰 파일 하나만 만들면 됨.
 */

// ─── 스킬 VFX 정의 ───

/** 스킬에 붙는 시각 이펙트 설정. 미설정 시 스킬 타입 기본 이펙트 사용. */
export interface SkillVfx {
  /** 시전 시 캐릭터 위치에 재생 (스킬 발동 순간) */
  cast?: string;
  /** 투사체 비행 중 잔상 (projectileSpeed 설정 시만 유효) */
  projectile?: string;
  /** 적중 시 대상 위치에 재생 (근접/투사체/텔레그래프 폭발) */
  hit?: string;
  /** 이펙트 스케일 배율 (기본 1.0) */
  scale?: number;
}

// ─── 필드 이펙트 타입 ───

/** 기본 필드 + 연계 반응 필드 */
export type FieldEffectType =
  | 'ignite' | 'freeze' | 'water' | 'grow' | 'mud' | 'shield'
  // 연계 반응으로만 생성
  | 'fog'      // 수증기/안개 — 시야 차단
  | 'ice'      // 빙판 — 미끄러짐
  | 'lava'     // 용암 — 고데미지 장판
  | 'swamp'    // 수렁 — 강화 진흙
  | 'pollen'   // 꽃가루 — 재채기
  | 'electric'; // 전자기장 — 감전

// ─── 패시브 스킬 정의 ───

/** 패시브 발동 조건 */
export type PassiveTrigger =
  | { type: 'on_field'; fieldTypes: FieldEffectType[] }   // 특정 장판 위에 있을 때
  | { type: 'on_hit_taken'; chance?: number }             // 피격 시 (확률)
  | { type: 'on_kill' }                                   // 적 처치/어시 시
  | { type: 'on_skill_hit'; stacks: number }              // 스킬 N회 적중 시
  | { type: 'stationary'; duration: number }              // N초 정지 시
  | { type: 'aura'; radius: number }                      // 주변 상시
  | { type: 'directional' }                               // 방향 기반 (에리스)
  | { type: 'always' }                                    // 상시 (블레이즈 불꽃잔상)
  | { type: 'low_hp'; threshold: number }                 // HP 비율 이하 시
  | { type: 'backstab' };                                 // 적 뒤쪽 공격 시

/** 패시브 효과 */
export interface PassiveEffect {
  // 자기 자신
  speedMult?: number;         // 이속 배율
  damageMult?: number;        // 공격력 배율
  defenseMult?: number;       // 피해감소 배율
  healMult?: number;          // 힐량 배율
  hpRegen?: number;           // 초당 HP 회복
  cooldownMult?: number;      // 쿨타임 배율 (0.8 = 20% 감소)
  stealth?: boolean;          // 은신
  // 적에게
  enemySpeedMult?: number;    // 적 이속 배율
  reflectDamage?: number;     // 반사 데미지
  extraStun?: number;         // 추가 스턴
  // 아군에게
  allySpeedMult?: number;     // 아군 이속 배율
  // 특수 메커니즘
  trail?: { fieldEffect: FieldEffectType; duration: number; damage: number };
  summon?: { type: string; damage: number; duration: number; maxStacks: number };
  bowling?: { damage: number; knockback: number; stunDuration: number };
  chainAttack?: { targets: number; damageRatio: number };
  fieldGenerate?: { fieldEffect: FieldEffectType; radius: number; interval: number };
  // 효과 조건
  duration?: number;          // 효과 지속 (킬 보상 등)
  cooldown?: number;          // 패시브 재발동 쿨
}

/** 패시브 스킬 시트 */
export interface PassiveSheet {
  name: string;
  icon: string;
  desc: string;               // 툴팁 설명
  trigger: PassiveTrigger;
  effects: PassiveEffect;
  vfx?: SkillVfx;
}

// ─── 스킬 정의 ───

export interface SkillSheet {
  name: string;
  type: 'damage' | 'heal' | 'field' | 'cc' | 'buff' | 'trap' | 'mobility';
  cooldown: number;         // 쿨타임 (초)
  initialCooldown: number;  // 게임 시작 시 남은 쿨타임
  damage: number;           // 양수=피해, 음수=회복
  range: number;            // 사거리 (타일)
  stunDuration: number;     // 스턴 지속 (초), 0=없음
  aoe: number;              // 범위 (0=단일 대상)
  fieldEffect?: FieldEffectType;
  // 투사체
  projectileSpeed?: number;
  tracking?: 'none' | 'loose';
  // 텔레그래프 (바닥 표시 후 폭발)
  telegraphDelay?: number;
  // 근접 공격 판정
  attackAngle?: number;     // 공격 범위 각도 (라디안)
  windupTime?: number;      // 선딜 (초) — 시전 시작 ~ 효과 발동까지 대기 (이동 불가)
  recoveryTime?: number;    // 후딜 (초) — 효과 발동 후 ~ 다음 행동까지 경직
  // 추가 CC 효과 (스턴 외)
  dot?: { damage: number; duration: number };     // 독/화상 DoT
  slow?: { ratio: number; duration: number };     // 슬로우
  root?: number;            // 속박 지속 (이동불가, 스킬가능)
  knockup?: number;         // 넉업 지속 (공중, 피격뎀 20%↑)
  // 트랩/설치물
  trap?: { count: number; lifetime: number; hidden?: boolean };
  // 텔레포트/도약
  teleport?: { stealthDuration?: number };
  // 소환물 (빙벽 등)
  summon?: { hp: number; duration: number; blocksMovement: boolean };
  // 특수: ignite 소비 증폭 (블레이즈 화염 선회)
  consumeField?: { fieldEffect: FieldEffectType; bonusDamage: number };
  // 버프 효과 (type='buff' 또는 fieldEffect='shield' 시 적용)
  buffEffects?: {
    speedMult?: number;       // 이속 배율 (1.4 = 40% 증가)
    damageMult?: number;      // 공격력 배율 (1.3 = 30% 증가)
    defenseMult?: number;     // 피해감소 배율 (0.6 = 40% 감소)
    duration: number;         // 버프 지속시간 (초)
  };
  // 시각 이펙트 (미설정 시 스킬 타입 기본값 사용)
  vfx?: SkillVfx;
}

// ─── 궁극기 정의 ───

export interface UltimateSheet {
  name: string;
  icon: string;
  castTime: number;         // 캐스팅 시간 (초)
  color: string;            // VFX 색상
  screenColor: string;      // 풀스크린 플래시 색상
  radius: number;           // 효과 범위
  damage: number;           // 피해량 (음수=회복)
  stunDuration: number;     // 스턴 (초)
  // 특수 효과 (캐릭터별)
  effects?: {
    knockback?: number;       // 넉백 거리
    burn?: number;            // 화상 지속 (초)
    invincible?: number;      // 무적 지속 (초)
    pull?: number;            // 흡인 거리
    frontAngle?: number;      // 전방 각도 제한 (라디안), 미설정=전방위
    allyHeal?: number;        // 아군 힐량
    allyInvincible?: number;  // 아군 무적 시간
    enemyKnockback?: number;  // 적 넉백 (바위 전용)
    enemyDamage?: number;     // 적 피해 (바위 전용)
    enemyStun?: number;       // 적 스턴 (바위 전용)
    distanceDecay?: boolean;  // 거리 감쇠 여부
  };
  // 궁극기 VFX (미설정 시 기본 폭발 이펙트)
  vfx?: SkillVfx;
}

// ─── 원소 속성 ───

export type ElementType = 'fire' | 'water' | 'earth' | 'nature';

// ─── 캐릭터 시트 ───

export interface CharSheet {
  // ── 기본 정보 ──
  id: string;               // 영문 ID (파일명과 동일)
  name: string;             // 표시 이름 (한글)
  role: string;             // 역할 표시 (탱커, 원딜, 힐러, ...)
  combatRole: 'ranged' | 'melee' | 'tank' | 'support';
  element: ElementType;     // 원소 속성 (타일 버프/디버프 판정)
  icon: string;             // 이모지 아이콘
  desc: string;             // 한줄 설명
  color: string;            // 대표 색상
  colorAlt: string;         // B팀 색상

  // ── 기본 스탯 ──
  hp: number;
  speed: number;
  size: number;             // 충돌 크기

  // ── 기본 공격 ──
  attackDamage: number;
  attackSpeed: number;      // 초당 공격 횟수
  attackRange: number;      // 사거리 (타일)

  // ── 시야 ──
  visionRange?: number;     // 시야 범위 (타일). 미설정 시 기본값 6

  // ── 패시브 (0~2개) ──
  passives: PassiveSheet[];

  // ── 스킬 ──
  skills: SkillSheet[];

  // ── 궁극기 ──
  ultimate: UltimateSheet;
}
