import { FieldGrid, FieldCell, Environment, Material } from './types.js';
import { updateThermalState, TransitionResult } from './heat-state-machine.js';
import { createWood, createSoil, createWater } from './materials.js';
import { hexNeighborsBounded } from './hex.js';
import * as C from './constants.js';

export function createFieldGrid(width: number, height: number): FieldGrid {
  const grid: FieldGrid = [];
  // 시드 기반 depth 생성: Perlin-like simplex noise 대신 간단한 해시 기반
  // 맵 가장자리 쪽은 깊고, 물가 근처에 깊은 웅덩이가 자연스럽게 배치되도록
  for (let y = 0; y < height; y++) {
    const row: FieldCell[] = [];
    for (let x = 0; x < width; x++) {
      // 해시 기반 pseudo-random depth (0~3)
      const hash = ((x * 73 + y * 137 + x * y * 31) & 0xff);
      // 약 15%의 타일이 깊은 지형 (depth >= 2)
      const depth = hash < 20 ? 3 : hash < 38 ? 2 : hash < 90 ? 1 : 0;
      row.push({ x, y, material: null, oxygen: 1.0, depth });
    }
    grid.push(row);
  }
  return grid;
}

// 성장/전환 타이머 (셀별 카운터)
const cellTimers = new Map<string, { ashTimer?: number; growthTimer?: number; freezeTimer?: number; waterSpreadTimer?: number; droughtTimer?: number; deadLandTimer?: number }>();

function getTimer(x: number, y: number) {
  const key = `${x},${y}`;
  if (!cellTimers.has(key)) cellTimers.set(key, {});
  return cellTimers.get(key)!;
}

// 타일 변화 콜백
export type TileChangeCallback = (x: number, y: number, from: string, to: string, matType: string) => void;
let onTileChange: TileChangeCallback | null = null;
export function setTileChangeCallback(cb: TileChangeCallback | null) { onTileChange = cb; }

export function tickField(grid: FieldGrid): void {
  const height = grid.length;
  const width = grid[0].length;

  // 1단계: 환경 수집 (6방향 hex)
  const envs: Environment[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Environment[] = [];
    for (let x = 0; x < width; x++) {
      row.push(computeEnvironment(grid, x, y, width, height));
    }
    envs.push(row);
  }

  // 2단계: 열 상태 전이
  let chainCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      if (!cell.material) continue;
      if (chainCount >= C.CHAIN_REACTION_MAX_OBJECTS) break;

      const prevState = cell.material.thermalState;
      const result = updateThermalState(cell.material, envs[y][x]);
      applyResult(cell.material, result);

      // 상태 변화 콜백
      if (cell.material.thermalState !== prevState && onTileChange) {
        onTileChange(x, y, prevState, cell.material.thermalState, cell.material.type);
      }

      if (result.sideEffects.length > 0) chainCount++;

      // Burning 물질이 인접 물을 증발시킴
      if (cell.material.thermalState === 'burning' && envs[y][x].waterContact) {
        consumeAdjacentWater(grid, x, y, width, height, 0.2);
      }

      // Ash 상태면 삭제하지 않고 유지 (Soil 전환 대기)
      if (cell.material.thermalState === 'ash') {
        const timer = getTimer(x, y);
        if (timer.ashTimer === undefined) {
          timer.ashTimer = C.ASH_TO_SOIL_TICKS;
        }
        continue;
      }

      // destroy 처리 (Ash가 아닌 물질만)
      if (result.sideEffects.some(e => e.type === 'destroy') ||
          cell.material.mass <= C.MASS_DESTROY_THRESHOLD) {
        cell.material = null;
      }
    }
  }

  // 3단계: 자원순환 처리
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      const timer = getTimer(x, y);

      // Ash→Soil 전환
      if (timer.ashTimer !== undefined && timer.ashTimer > 0) {
        timer.ashTimer--;
        if (timer.ashTimer <= 0) {
          cell.material = createSoil(1);
          cell.material.temperature = C.TEMP_AMBIENT;
          timer.ashTimer = undefined;
          if (onTileChange) onTileChange(x, y, 'ash', 'soil:normal', 'soil');
        }
      }

      if (!cell.material) {
        timer.growthTimer = undefined;
        timer.freezeTimer = undefined;

        // ─── 죽은땅 + 인접 물 → 영구 물웅덩이 or 식물 ───
        const hasWaterNearby = hasAdjacentWater(grid, x, y, width, height);
        if (hasWaterNearby) {
          timer.deadLandTimer = (timer.deadLandTimer || 0) + 1;
          const isDeep = cell.depth >= C.DEPTH_DEEP_THRESHOLD;
          const neededTicks = isDeep ? C.DEAD_LAND_POOL_TICKS : C.DEAD_LAND_GROW_TICKS;
          if (timer.deadLandTimer >= neededTicks) {
            if (isDeep) {
              // 깊은 죽은땅 → 영구 물웅덩이
              cell.material = createWater(C.PERMANENT_POOL_MASS);
              cell.material.permanent = true;
              if (onTileChange) onTileChange(x, y, 'dead', 'water:permanent', 'water');
            } else {
              // 얕은 죽은땅 → 식물 직접 성장
              cell.material = createWood(3);
              if (onTileChange) onTileChange(x, y, 'dead', 'wood:normal', 'wood');
            }
            consumeAdjacentWater(grid, x, y, width, height, C.GROWTH_WATER_COST);
            timer.deadLandTimer = undefined;
          }
        } else {
          timer.deadLandTimer = 0;
        }

        continue;
      }

      // 흙+물 → 나무 성장
      if (cell.material.type === 'soil' &&
          (cell.material.thermalState === 'normal' || cell.material.thermalState === 'damp') &&
          cell.material.temperature < 100) {
        const hasWater = hasAdjacentWater(grid, x, y, width, height);
        if (hasWater) {
          const growTime = cell.material.thermalState === 'damp' ? C.DAMP_GROWTH_TICKS : C.SOIL_GROWTH_TICKS;
          timer.growthTimer = (timer.growthTimer || 0) + 1;
          if (timer.growthTimer >= growTime) {
            cell.material = createWood(3);
            timer.growthTimer = undefined;
            if (onTileChange) onTileChange(x, y, 'soil', 'wood:normal', 'wood');
            consumeAdjacentWater(grid, x, y, width, height, C.GROWTH_WATER_COST);
          }
        } else {
          timer.growthTimer = 0;
        }
      }

      // 나무(식물)의 물 지속 소모 + 인접 타일로 물 전파 + 가뭄 건조
      if (cell.material.type === 'wood' &&
          (cell.material.thermalState === 'normal' || cell.material.thermalState === 'damp')) {
        const neighbors = hexNeighborsBounded(x, y, width, height);

        // (a) 물 지속 소모: 나무가 인접 물을 조금씩 흡수 (식물은 물을 더 빨리 소모)
        let hasNearbyWater = false;
        let hasHydratedNeighbor = false; // 인접 damp 나무 (뿌리 수분 공유)
        const consumeRate = C.WOOD_WATER_CONSUME_PER_TICK * C.PLANT_WATER_CONSUME_MULTIPLIER;
        for (const nb of neighbors) {
          const n = grid[nb.row][nb.col];
          if (n.material && n.material.type === 'water' && n.material.thermalState === 'normal') {
            hasNearbyWater = true;
            // 영구 물웅덩이는 mass 소모 안 됨
            if (!n.material.permanent) {
              n.material.mass -= consumeRate;
              if (n.material.mass <= C.MASS_DESTROY_THRESHOLD) {
                n.material = null;
              }
            }
            break; // 틱당 하나의 물 타일에서만 소모
          }
          if (n.material && n.material.type === 'wood' && n.material.thermalState === 'damp') {
            hasHydratedNeighbor = true;
          }
        }

        // (c) 가뭄 → 건조: 인접 물도 damp 나무도 없으면 타이머 증가
        const hasMoisture = hasNearbyWater || hasHydratedNeighbor;
        if (!hasMoisture) {
          timer.droughtTimer = (timer.droughtTimer || 0) + 1;
          if (timer.droughtTimer >= C.WOOD_DROUGHT_TICKS) {
            cell.material.thermalState = 'dry' as Material['thermalState'];
            cell.material.combustibility = C.DRY_WOOD_COMBUSTIBILITY;
            cell.material.ignitionTemp = C.DRY_WOOD_IGNITION_TEMP;
            timer.droughtTimer = undefined;
            if (onTileChange) onTileChange(x, y, 'normal', 'dry(drought)', 'wood');
          }
        } else {
          timer.droughtTimer = 0; // 물 또는 damp 나무 인접 시 가뭄 리셋
        }

        // (b) 물 전파: 나무가 인접 물을 다른 인접 빈 타일로 퍼뜨림
        timer.waterSpreadTimer = (timer.waterSpreadTimer || 0) + 1;
        if (timer.waterSpreadTimer >= C.WOOD_WATER_SPREAD_INTERVAL) {
          timer.waterSpreadTimer = 0;

          // 인접 물 타일 중 가장 mass가 큰 것을 원천으로 선택
          let sourceCell: FieldCell | null = null;
          let sourceMass = 0;
          for (const nb of neighbors) {
            const n = grid[nb.row][nb.col];
            if (n.material && n.material.type === 'water' && n.material.thermalState === 'normal' &&
                n.material.mass > C.WOOD_WATER_SPREAD_MIN_SOURCE) {
              if (n.material.mass > sourceMass) {
                sourceMass = n.material.mass;
                sourceCell = n;
              }
            }
          }

          if (sourceCell && sourceCell.material) {
            const isPermanentSource = !!sourceCell.material.permanent;
            // 빈 타일이나 이미 있는 물 타일 중 mass가 원천보다 적은 곳으로 전파
            for (const nb of neighbors) {
              const n = grid[nb.row][nb.col];
              if (!n.material) {
                // 빈 타일에 새 물 생성 (원천보다 적은 양)
                const spreadAmount = Math.min(C.WOOD_WATER_SPREAD_PER_TICK, sourceCell.material!.mass * 0.1);
                if (spreadAmount > C.MASS_DESTROY_THRESHOLD) {
                  n.material = createWater(spreadAmount);
                  // 영구 물웅덩이는 mass 소모 안 됨
                  if (!isPermanentSource) {
                    sourceCell.material!.mass -= spreadAmount;
                    if (sourceCell.material!.mass <= C.MASS_DESTROY_THRESHOLD) {
                      sourceCell.material = null;
                      break;
                    }
                  }
                }
              } else if (n.material.type === 'water' && n.material.thermalState === 'normal' &&
                         n.material.mass < sourceMass) {
                // 기존 물 타일이 원천보다 적으면 보충 (원천 mass를 절대 초과 불가)
                const maxTransfer = sourceMass - n.material.mass;
                const spreadAmount = Math.min(C.WOOD_WATER_SPREAD_PER_TICK, maxTransfer * 0.5, sourceCell.material!.mass * 0.1);
                if (spreadAmount > 0.01) {
                  n.material.mass += spreadAmount;
                  if (!isPermanentSource) {
                    sourceCell.material!.mass -= spreadAmount;
                    if (sourceCell.material!.mass <= C.MASS_DESTROY_THRESHOLD) {
                      sourceCell.material = null;
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      } else if (cell.material.type === 'wood' && cell.material.thermalState === 'dry') {
        // dry 나무 복구: 인접 물 또는 damp 나무가 있으면 normal로 복구
        const neighbors = hexNeighborsBounded(x, y, width, height);
        for (const nb of neighbors) {
          const n = grid[nb.row][nb.col];
          if (n.material && (
            (n.material.type === 'water' && n.material.thermalState === 'normal') ||
            (n.material.type === 'wood' && n.material.thermalState === 'damp')
          )) {
            cell.material.thermalState = 'damp' as Material['thermalState'];
            cell.material.combustibility = 8;
            cell.material.ignitionTemp = 200;
            if (onTileChange) onTileChange(x, y, 'dry', 'damp(rehydrated)', 'wood');
            break;
          }
        }
        timer.waterSpreadTimer = undefined;
        timer.droughtTimer = undefined;
      } else {
        timer.waterSpreadTimer = undefined;
        timer.droughtTimer = undefined;
      }

      // 나무 + 인접 얼음 → 동사
      if (cell.material.type === 'wood' && cell.material.thermalState === 'normal') {
        const hasIce = hasAdjacentIce(grid, x, y, width, height);
        if (hasIce) {
          timer.freezeTimer = (timer.freezeTimer || 0) + 1;
          if (timer.freezeTimer >= C.FREEZE_KILL_TICKS) {
            cell.material.thermalState = 'dry' as Material['thermalState'];
            cell.material.combustibility = 16;
            cell.material.ignitionTemp = C.DRY_WOOD_IGNITION_TEMP;
            cell.material.mass *= 0.5;
            timer.freezeTimer = undefined;
            if (onTileChange) onTileChange(x, y, 'normal', 'dry(frozen)', 'wood');
          }
        } else {
          timer.freezeTimer = 0;
        }
      }
    }
  }
}

function computeEnvironment(grid: FieldGrid, x: number, y: number, w: number, h: number): Environment {
  let adjacentHeat = 0;
  let waterContact = false;

  const neighbors = hexNeighborsBounded(x, y, w, h);

  for (const nb of neighbors) {
    const n = grid[nb.row][nb.col];
    if (!n.material) {
      // 빈 칸 복사열: 빈 칸 너머의 hex 이웃 중 Burning 체크
      const nbs2 = hexNeighborsBounded(nb.col, nb.row, w, h);
      for (const nb2 of nbs2) {
        if (nb2.col === x && nb2.row === y) continue; // 자기 자신 제외
        const nn = grid[nb2.row][nb2.col];
        if (nn.material && nn.material.thermalState === 'burning') {
          adjacentHeat += C.HEAT_PROPAGATION_PER_TICK * C.HEAT_RADIATION_EMPTY;
          break; // 빈 칸당 1회만
        }
      }
      continue;
    }

    // hex 이웃은 모두 등거리 — 대각선 비율 없음
    if (n.material.thermalState === 'burning') {
      adjacentHeat += C.HEAT_PROPAGATION_PER_TICK;
    } else if (n.material.thermalState === 'smoldering') {
      adjacentHeat += C.HEAT_PROPAGATION_PER_TICK * 0.3;
    } else if (n.material.thermalState === 'molten') {
      adjacentHeat += C.HEAT_PROPAGATION_PER_TICK * 0.5;
    } else if (n.material.thermalState === 'heated') {
      adjacentHeat += C.HEAT_PROPAGATION_PER_TICK * 0.2;
    }

    if (n.material.type === 'water' && n.material.thermalState === 'normal') {
      waterContact = true;
    }
  }

  return {
    adjacentHeat,
    oxygen: grid[y][x].oxygen,
    waterContact,
    windSpeed: 0,
  };
}

function hasAdjacentWater(grid: FieldGrid, x: number, y: number, w: number, h: number): boolean {
  for (const nb of hexNeighborsBounded(x, y, w, h)) {
    const n = grid[nb.row][nb.col];
    if (n.material && n.material.type === 'water' && n.material.thermalState === 'normal') return true;
  }
  return false;
}

function hasAdjacentIce(grid: FieldGrid, x: number, y: number, w: number, h: number): boolean {
  for (const nb of hexNeighborsBounded(x, y, w, h)) {
    const n = grid[nb.row][nb.col];
    if (n.material && n.material.thermalState === 'frozen') return true;
  }
  return false;
}

function consumeAdjacentWater(grid: FieldGrid, x: number, y: number, w: number, h: number, amount: number): void {
  for (const nb of hexNeighborsBounded(x, y, w, h)) {
    const n = grid[nb.row][nb.col];
    if (n.material && n.material.type === 'water' && n.material.thermalState === 'normal') {
      // 영구 물웅덩이는 mass 소모 안 됨 (깊은 지형의 물)
      if (n.material.permanent) return;
      n.material.mass -= amount;
      if (n.material.mass <= C.MASS_DESTROY_THRESHOLD) n.material = null;
      return;
    }
  }
}

function applyResult(mat: Material, result: TransitionResult): void {
  mat.temperature = Math.max(0, Math.min(1000, mat.temperature + result.temperatureDelta));
  mat.mass = Math.max(0, mat.mass + result.massDelta);
  mat.thermalState = result.newState;
}
