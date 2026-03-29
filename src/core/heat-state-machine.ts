import { Material, ThermalState, Environment, SideEffect } from './types.js';
import * as C from './constants.js';

export interface TransitionResult {
  newState: ThermalState;
  temperatureDelta: number;
  massDelta: number;
  sideEffects: SideEffect[];
}

export function updateThermalState(mat: Material, env: Environment): TransitionResult {
  switch (mat.type) {
    case 'wood': return updateWood(mat, env);
    case 'metal': return updateMetal(mat, env);
    case 'soil': return updateSoil(mat, env);
    case 'sand': return updateSoil(mat, env); // 모래는 흙과 동일 로직, 임계값만 다름
    case 'water': return updateWater(mat, env);
  }
}

// ─── 나무 ───

function updateWood(mat: Material, env: Environment): TransitionResult {
  const effects: SideEffect[] = [];
  let tempDelta = 0;
  let massDelta = 0;
  let newState = mat.thermalState;

  // 온도 변화 계산
  tempDelta += env.adjacentHeat;
  if (env.waterContact) tempDelta -= C.WATER_COOLING_PER_TICK;
  tempDelta += env.windSpeed * C.WIND_MAX_HEAT_BOOST;
  if (mat.temperature > C.TEMP_AMBIENT) tempDelta -= C.HEAT_NATURAL_COOLING;

  const nextTemp = mat.temperature + tempDelta;

  switch (mat.thermalState) {
    case 'normal':
    case 'damp':
    case 'dry':
      if (env.waterContact && mat.thermalState === 'normal') {
        newState = 'damp';
      }
      if (nextTemp >= mat.ignitionTemp && mat.combustibility > 0 && env.oxygen > 0.1) {
        newState = 'burning';
      }
      if (mat.thermalState === 'damp' && !env.waterContact) {
        newState = 'normal'; // 물 접촉 없으면 자연 건조
      }
      // dry 상태에서 물 접촉 시 복구
      if (mat.thermalState === 'dry' && env.waterContact) {
        newState = 'damp';
        mat.combustibility = 8;    // 원래 가연성 복구
        mat.ignitionTemp = 200;    // 원래 점화 온도 복구
      }
      break;

    case 'burning':
      massDelta = -C.WOOD_BURN_MASS_LOSS;
      effects.push({ type: 'emit_heat', amount: C.HEAT_PROPAGATION_PER_TICK });
      effects.push({ type: 'emit_smoke' });
      effects.push({ type: 'reduce_mass', amount: C.WOOD_BURN_MASS_LOSS });

      if (env.oxygen < 0.1) {
        newState = 'smoldering';
      } else if (env.waterContact) {
        // 불 vs 물: 온도가 높을수록 소화 저항
        // 300T 이상이면 물이 증기로 바뀌면서 소화 실패 (물만 소모)
        if (mat.temperature < 300) {
          // 불이 약함 → 소화 성공
          newState = 'damp';
          tempDelta -= C.WATER_COOLING_PER_TICK * 2;
        } else {
          // 불이 강함 → 소화 실패, 물이 증기로 증발
          tempDelta -= C.WATER_COOLING_PER_TICK; // 냉각은 되지만 꺼지진 않음
        }
        effects.push({ type: 'create_steam', amount: 1 });
        effects.push({ type: 'reduce_mass', amount: 0.3 }); // 물 소모 (인접 물의 mass를 줄이는 효과)
      } else if (mat.mass + massDelta <= 0.8) {
        newState = 'smoldering'; // mass 0.8 이하에서 smoldering (더 오래 burning 유지)
      }

      // 바람 → 불 강화
      if (env.windSpeed > 0.5) {
        effects.push({ type: 'emit_heat', amount: C.HEAT_PROPAGATION_PER_TICK * env.windSpeed });
      }
      break;

    case 'smoldering':
      massDelta = -C.WOOD_SMOLDER_MASS_LOSS;
      effects.push({ type: 'emit_heat', amount: C.HEAT_PROPAGATION_PER_TICK * 0.3 });

      // 재점화: 외부에서 직접 열을 받았을 때만 (인접 Burning 열은 재점화 안 함)
      // → 재점화는 스킬(방화 등)으로만 가능하게
      if (mat.mass + massDelta <= 1) {
        newState = 'charcoal';
      }
      break;

    case 'charcoal':
      massDelta = -C.WOOD_SMOLDER_MASS_LOSS * 2; // 0.05→0.2 빠르게 Ash로
      if (mat.mass + massDelta <= C.MASS_DESTROY_THRESHOLD) {
        newState = 'ash';
      }
      break;

    case 'ash':
      if (env.windSpeed > 0.3) {
        newState = 'dispersed';
        effects.push({ type: 'destroy' });
      }
      break;
  }

  return { newState, temperatureDelta: tempDelta, massDelta, sideEffects: effects };
}

// ─── 금속 ───

function updateMetal(mat: Material, env: Environment): TransitionResult {
  const effects: SideEffect[] = [];
  let tempDelta = 0;
  const massDelta = 0;
  let newState = mat.thermalState;

  tempDelta += env.adjacentHeat;
  if (env.waterContact) tempDelta -= C.WATER_COOLING_PER_TICK;
  if (mat.temperature > C.TEMP_AMBIENT) tempDelta -= C.HEAT_NATURAL_COOLING;

  const nextTemp = mat.temperature + tempDelta;

  switch (mat.thermalState) {
    case 'normal':
      if (nextTemp >= C.TEMP_METAL_HEATED) newState = 'heated';
      break;

    case 'heated':
      if (nextTemp >= C.TEMP_METAL_MOLTEN) {
        newState = 'molten';
      } else if (nextTemp < C.TEMP_METAL_HEATED) {
        // 급냉 체크
        if (mat.temperature - nextTemp >= 400) {
          newState = 'brittle';
        } else {
          newState = 'normal';
        }
      }
      break;

    case 'molten':
      effects.push({ type: 'emit_heat', amount: C.HEAT_PROPAGATION_PER_TICK * 0.5 });
      if (nextTemp < C.TEMP_METAL_MOLTEN) {
        if (env.waterContact || mat.temperature - nextTemp >= 400) {
          newState = 'brittle';
        } else {
          newState = 'heated';
        }
      }
      break;

    case 'brittle':
      if (nextTemp >= C.TEMP_METAL_HEATED) {
        newState = 'heated'; // 재가열하면 취성 해소
      }
      break;
  }

  return { newState, temperatureDelta: tempDelta, massDelta, sideEffects: effects };
}

// ─── 흙/모래 ───

function updateSoil(mat: Material, env: Environment): TransitionResult {
  const effects: SideEffect[] = [];
  let tempDelta = 0;
  const massDelta = 0;
  let newState = mat.thermalState;

  tempDelta += env.adjacentHeat;
  if (env.waterContact) tempDelta -= C.WATER_COOLING_PER_TICK;
  if (mat.temperature > C.TEMP_AMBIENT) tempDelta -= C.HEAT_NATURAL_COOLING;

  const nextTemp = mat.temperature + tempDelta;
  const isGlass = mat.type === 'sand' && nextTemp >= C.TEMP_SAND_GLASS;

  switch (mat.thermalState) {
    case 'normal':
    case 'damp':
      if (env.waterContact) {
        newState = 'damp';
      } else if (nextTemp >= C.TEMP_SOIL_DRY) {
        newState = 'dry';
      }
      break;

    case 'dry':
      if (nextTemp >= C.TEMP_SOIL_BAKED) {
        newState = 'baked'; // 경화 — 방어↑
      } else if (env.waterContact) {
        newState = 'damp';
      }
      break;

    case 'baked':
      if (nextTemp >= C.TEMP_SOIL_CERAMIC) {
        newState = 'ceramic'; // 취성 — 충격 취약
      } else if (nextTemp < C.TEMP_SOIL_BAKED) {
        newState = 'dry';
      }
      break;

    case 'ceramic':
      if (isGlass) {
        // 유리화는 시각적 변화만 (상태는 ceramic 유지)
      }
      if (nextTemp < C.TEMP_SOIL_CERAMIC) {
        newState = 'baked';
      }
      break;
  }

  return { newState, temperatureDelta: tempDelta, massDelta, sideEffects: effects };
}

// ─── 물 ───

function updateWater(mat: Material, env: Environment): TransitionResult {
  const effects: SideEffect[] = [];
  let tempDelta = 0;
  let massDelta = 0;
  let newState = mat.thermalState;

  tempDelta += env.adjacentHeat;
  if (mat.temperature > C.TEMP_AMBIENT) tempDelta -= C.HEAT_NATURAL_COOLING;

  const nextTemp = mat.temperature + tempDelta;

  switch (mat.thermalState) {
    case 'normal':
      if (nextTemp <= C.TEMP_WATER_FREEZE) {
        newState = 'frozen';
      } else if (nextTemp >= C.TEMP_WATER_BOIL) {
        newState = 'steam';
        massDelta = -1; // 증발로 양 감소
        effects.push({ type: 'create_steam', amount: 1 });
      }
      break;

    case 'frozen':
      if (nextTemp > C.TEMP_WATER_FREEZE + 5) {
        newState = 'normal'; // 해빙
      }
      break;

    case 'steam':
      massDelta = -0.5; // 계속 흩어짐
      effects.push({ type: 'emit_heat', amount: 5 });
      if (mat.mass + massDelta <= C.MASS_DESTROY_THRESHOLD) {
        newState = 'dispersed';
        effects.push({ type: 'destroy' });
      } else if (nextTemp < C.TEMP_WATER_BOIL - 20) {
        newState = 'normal'; // 응결
      }
      break;
  }

  return { newState, temperatureDelta: tempDelta, massDelta, sideEffects: effects };
}
