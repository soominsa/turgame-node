// ─── Material Types ───

export type MaterialType = 'wood' | 'metal' | 'soil' | 'sand' | 'water';

export type ThermalState =
  | 'normal'
  | 'damp'
  | 'heating'
  | 'burning'
  | 'smoldering'
  | 'charcoal'
  | 'ash'
  | 'heated'
  | 'molten'
  | 'brittle'
  | 'dry'
  | 'baked'
  | 'ceramic'
  | 'frozen'
  | 'steam'
  | 'dispersed';

export interface Material {
  type: MaterialType;
  mass: number;
  temperature: number;       // 0~1000 T
  structure: number;          // 내구도
  combustibility: number;     // 가연성 (0 = 불연성)
  ignitionTemp: number;       // 점화 온도
  thermalState: ThermalState;
  conductivity: number;       // 전도성 0~1
  heatCapacity: number;       // 열용량 계수
  permanent?: boolean;        // 영구 물웅덩이 여부 (깊은 지형에 생긴 물)
}

// ─── Field ───

export interface FieldCell {
  x: number;
  y: number;
  material: Material | null;
  oxygen: number;             // 0~1 (1 = 정상, 0 = 진공)
  depth: number;              // 지형 깊이 (0=얕음, 1+=깊음). 깊으면 영구 물웅덩이, 얕으면 식물 성장
}

export type FieldGrid = FieldCell[][];

// ─── Side Effects (열 상태 전이 시 발생) ───

export type SideEffect =
  | { type: 'emit_heat'; amount: number }
  | { type: 'emit_smoke' }
  | { type: 'reduce_mass'; amount: number }
  | { type: 'create_steam'; amount: number }
  | { type: 'explode'; damage: number; radius: number }
  | { type: 'destroy' };

// ─── Environment (상태 전이 판단에 필요한 주변 정보) ───

export interface Environment {
  adjacentHeat: number;       // 인접 셀로부터 받는 열 (T/틱)
  oxygen: number;             // 0~1
  waterContact: boolean;      // 물과 접촉 중인지
  windSpeed: number;          // 0~1 (0 = 무풍, 1 = 강풍)
}
