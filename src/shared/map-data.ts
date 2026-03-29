/**
 * 공통 맵 데이터 — 싱글/멀티/시뮬레이터 모두 이 파일에서 import
 * 맵 변경 시 여기만 수정하면 전체 반영됨
 */

import { CapturePoint, Wall, ResourceTerrain } from '../game/game-engine.js';
import { createWood, createWater, createSoil } from '../core/materials.js';
import { createFieldGrid } from '../core/tick-engine.js';

// ─── 필드 크기 ───

export const FIELD_W = 50;
export const FIELD_H = 26;

// ─── 스폰 위치 ───

export const SPAWN_A: [number, number][] = [[4, 13], [4, 10], [3, 16], [3, 10]];
export const SPAWN_B: [number, number][] = [[46, 13], [46, 16], [47, 10], [47, 16]];

// ─── 거점 ───

export function createPoints(): CapturePoint[] {
  return [
    { x: 10, y: 13, radius: 2.5, owner: 'neutral', progress: 0, capturingTeam: null },
    { x: 20, y: 7,  radius: 2.5, owner: 'neutral', progress: 0, capturingTeam: null },
    { x: 25, y: 13, radius: 2.5, owner: 'neutral', progress: 0, capturingTeam: null },
    { x: 30, y: 19, radius: 2.5, owner: 'neutral', progress: 0, capturingTeam: null },
    { x: 40, y: 13, radius: 2.5, owner: 'neutral', progress: 0, capturingTeam: null },
  ];
}

// ─── 벽/장애물 ───

export function createWalls(): Wall[] {
  return [
    // 중앙 거점 주변 바위
    { x: 24, y: 11, type: 'rock' }, { x: 26, y: 11, type: 'rock' },
    { x: 24, y: 15, type: 'rock' }, { x: 26, y: 15, type: 'rock' },
    // 좌측 울타리 (11칸, y=8~18)
    { x: 14, y: 8, type: 'fence' }, { x: 14, y: 9, type: 'fence' },
    { x: 14, y: 10, type: 'fence' }, { x: 14, y: 11, type: 'fence' },
    { x: 14, y: 12, type: 'fence' }, { x: 14, y: 13, type: 'fence' },
    { x: 14, y: 14, type: 'fence' }, { x: 14, y: 15, type: 'fence' },
    { x: 14, y: 16, type: 'fence' }, { x: 14, y: 17, type: 'fence' },
    { x: 14, y: 18, type: 'fence' },
    // 우측 울타리 (11칸, y=8~18)
    { x: 36, y: 8, type: 'fence' }, { x: 36, y: 9, type: 'fence' },
    { x: 36, y: 10, type: 'fence' }, { x: 36, y: 11, type: 'fence' },
    { x: 36, y: 12, type: 'fence' }, { x: 36, y: 13, type: 'fence' },
    { x: 36, y: 14, type: 'fence' }, { x: 36, y: 15, type: 'fence' },
    { x: 36, y: 16, type: 'fence' }, { x: 36, y: 17, type: 'fence' },
    { x: 36, y: 18, type: 'fence' },
    // 진영 폐허
    { x: 6, y: 8, type: 'ruin' }, { x: 6, y: 9, type: 'ruin' },
    { x: 44, y: 17, type: 'ruin' }, { x: 44, y: 18, type: 'ruin' },
    // 상하단 바위
    { x: 18, y: 4, type: 'rock' }, { x: 32, y: 4, type: 'rock' },
    { x: 18, y: 22, type: 'rock' }, { x: 32, y: 22, type: 'rock' },
    // 추가 엄폐
    { x: 25, y: 6, type: 'rock' }, { x: 25, y: 20, type: 'rock' },
  ];
}

// ─── 자원 지형 ───

export function createTerrains(): ResourceTerrain[] {
  return [
    { type: 'moss', x: 10, y: 16, radius: 2.5, boostRadius: 3 },
    { type: 'wind', x: 20, y: 5, radius: 3, boostRadius: 3 },
    { type: 'ore', x: 25, y: 11, radius: 2, boostRadius: 3 },
    { type: 'vent', x: 30, y: 21, radius: 2, boostRadius: 3 },
    { type: 'crystal', x: 40, y: 11, radius: 2, boostRadius: 3 },
    { type: 'moss', x: 40, y: 16, radius: 2, boostRadius: 3 },
  ];
}

// ─── 필드 지형 생성 (싱글/멀티/시뮬레이터 공용) ───

export function generateFieldTerrain(field: ReturnType<typeof createFieldGrid>) {
  // 중앙 대형 숲
  for (let y = 9; y <= 17; y++)
    for (let x = 21; x <= 29; x++)
      if (Math.random() > 0.3) field[y][x].material = createWood(4 + Math.random() * 2);

  // 좌측 연못
  for (let y = 10; y <= 16; y++)
    for (let x = 8; x <= 12; x++)
      if (Math.abs(y - 13) + Math.abs(x - 10) < 3.5) field[y][x].material = createWater(5 + Math.random() * 3);

  // 우측 연못
  for (let y = 10; y <= 16; y++)
    for (let x = 38; x <= 42; x++)
      if (Math.abs(y - 13) + Math.abs(x - 40) < 3.5) field[y][x].material = createWater(5 + Math.random() * 3);

  // 상단 흙 지대
  for (let y = 4; y <= 8; y++)
    for (let x = 18; x <= 22; x++)
      if (Math.random() > 0.4) field[y][x].material = createSoil(4);

  // 하단 흙 지대
  for (let y = 18; y <= 22; y++)
    for (let x = 28; x <= 32; x++)
      if (Math.random() > 0.4) field[y][x].material = createSoil(4);

  // 하단 강 (y=24~25, 맵 전체 가로)
  for (let y = 24; y <= 25; y++)
    for (let x = 0; x < FIELD_W; x++)
      field[y][x].material = createWater(4 + Math.random() * 3);

  // 강가 습지 (y=23, 부분적)
  for (let x = 0; x < FIELD_W; x++)
    if (Math.random() < 0.4) field[23][x].material = createWater(2 + Math.random() * 2);

  // 산발적 나무 (맵 전체)
  for (let i = 0; i < 30; i++) {
    const rx = 3 + Math.floor(Math.random() * (FIELD_W - 6));
    const ry = 3 + Math.floor(Math.random() * (FIELD_H - 6));
    if (!field[ry][rx].material) field[ry][rx].material = createWood(3);
  }
}

// ─── 스킬 샌드박스 맵 ───

export const SANDBOX_W = 30;
export const SANDBOX_H = 20;

export const SANDBOX_SPAWN_A: [number, number][] = [[3, 10]];
export const SANDBOX_SPAWN_B: [number, number][] = [[22, 7], [22, 13], [26, 7], [26, 13]];

export function createSandboxPoints(): CapturePoint[] {
  // 샌드박스에서는 거점 없음 (자유 테스트)
  return [];
}

export function createSandboxWalls(): Wall[] {
  return [
    // 외곽 경계 바위 (상/하)
    ...[5, 10, 15, 20, 25].map(x => ({ x, y: 1, type: 'rock' as const })),
    ...[5, 10, 15, 20, 25].map(x => ({ x, y: 18, type: 'rock' as const })),
    // 중앙 타일 존과 적 테스트 존 사이 구분 울타리
    { x: 18, y: 6, type: 'fence' as const },
    { x: 18, y: 7, type: 'fence' as const },
    { x: 18, y: 8, type: 'fence' as const },
    // 통로 (y=9, 10, 11 비움)
    { x: 18, y: 12, type: 'fence' as const },
    { x: 18, y: 13, type: 'fence' as const },
    { x: 18, y: 14, type: 'fence' as const },
    // 엄폐물 (스킬 테스트용)
    { x: 8, y: 5, type: 'rock' as const },
    { x: 8, y: 15, type: 'rock' as const },
  ];
}

/**
 * 샌드박스 자원 지형 — 중앙에 4속성 타일 6개씩 배치
 * fire(vent), water(pool), earth(ore), nature(moss)
 */
export function createSandboxTerrains(): ResourceTerrain[] {
  return [
    // 🔥 화염 지대 (좌상) — vent 6개
    { type: 'vent', x: 8,  y: 5, radius: 1.2, boostRadius: 2 },
    { type: 'vent', x: 9,  y: 5, radius: 1.2, boostRadius: 2 },
    { type: 'vent', x: 10, y: 5, radius: 1.2, boostRadius: 2 },
    { type: 'vent', x: 8,  y: 6, radius: 1.2, boostRadius: 2 },
    { type: 'vent', x: 9,  y: 6, radius: 1.2, boostRadius: 2 },
    { type: 'vent', x: 10, y: 6, radius: 1.2, boostRadius: 2 },
    // 💧 물 지대 (우상) — pool 6개
    { type: 'pool', x: 13, y: 5, radius: 1.2, boostRadius: 2 },
    { type: 'pool', x: 14, y: 5, radius: 1.2, boostRadius: 2 },
    { type: 'pool', x: 15, y: 5, radius: 1.2, boostRadius: 2 },
    { type: 'pool', x: 13, y: 6, radius: 1.2, boostRadius: 2 },
    { type: 'pool', x: 14, y: 6, radius: 1.2, boostRadius: 2 },
    { type: 'pool', x: 15, y: 6, radius: 1.2, boostRadius: 2 },
    // ⛏️ 대지 지대 (좌하) — ore 6개
    { type: 'ore', x: 8,  y: 13, radius: 1.2, boostRadius: 2 },
    { type: 'ore', x: 9,  y: 13, radius: 1.2, boostRadius: 2 },
    { type: 'ore', x: 10, y: 13, radius: 1.2, boostRadius: 2 },
    { type: 'ore', x: 8,  y: 14, radius: 1.2, boostRadius: 2 },
    { type: 'ore', x: 9,  y: 14, radius: 1.2, boostRadius: 2 },
    { type: 'ore', x: 10, y: 14, radius: 1.2, boostRadius: 2 },
    // 🍄 자연 지대 (우하) — moss 6개
    { type: 'moss', x: 13, y: 13, radius: 1.2, boostRadius: 2 },
    { type: 'moss', x: 14, y: 13, radius: 1.2, boostRadius: 2 },
    { type: 'moss', x: 15, y: 13, radius: 1.2, boostRadius: 2 },
    { type: 'moss', x: 13, y: 14, radius: 1.2, boostRadius: 2 },
    { type: 'moss', x: 14, y: 14, radius: 1.2, boostRadius: 2 },
    { type: 'moss', x: 15, y: 14, radius: 1.2, boostRadius: 2 },
  ];
}
