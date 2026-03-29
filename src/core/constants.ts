// ─── 글로벌 상수 (balance-sheet.md 기준) ───

export const TICK_RATE = 4;                    // 틱/초
export const TICK_DURATION = 1 / TICK_RATE;    // 0.25초/틱

// ─── 온도 (heat-state-machine.md) ───

export const TEMP_AMBIENT = 20;                // 상온
export const TEMP_WATER_FREEZE = 0;
export const TEMP_WATER_BOIL = 100;
export const TEMP_WOOD_IGNITE = 200;
export const TEMP_WOOD_FULL_BURN = 400;
export const TEMP_METAL_HEATED = 600;
export const TEMP_METAL_MOLTEN = 800;
export const TEMP_SAND_GLASS = 1000;
export const TEMP_SOIL_DRY = 100;
export const TEMP_SOIL_BAKED = 300;
export const TEMP_SOIL_CERAMIC = 500;

// ─── 열 전파 ───

export const HEAT_PROPAGATION_PER_TICK = 20;   // Burning 물질의 인접 가열 (T/틱). 8방향→6방향 보정 (15*8/6≈20)
export const HEAT_DISTANCE_DECAY = 0.5;        // 1u마다 50% 감소
export const HEAT_NATURAL_COOLING = 2;         // 틱당 자연 냉각 (상온 복귀)
export const WATER_COOLING_PER_TICK = 40;      // 물 접촉 냉각
export const WIND_MAX_HEAT_BOOST = 30;         // 강풍 시 최대 가열 보너스

// ─── 연쇄 반응 제한 ───

export const CHAIN_REACTION_MAX_DEPTH = 3;
export const CHAIN_REACTION_DECAY = 0.2;       // 단계당 20% 감쇠
export const CHAIN_REACTION_MAX_OBJECTS = 40;   // 20→40 (큰 맵)

// ─── 화공 시스템 ───

export const HEAT_DIAGONAL_RATIO = 1.0;        // hex 그리드: 모든 이웃 등거리 (레거시 호환)
export const HEAT_RADIATION_EMPTY = 0.3;        // 빈 칸 복사열 비율
export const SMOKE_RANGE = 2;                   // 연기 범위 (타일)
export const HEAT_AURA_RANGE = 2;               // 열기 범위 (타일)
export const SMOKE_VISION_PENALTY = 0.6;        // 연기 시야 감소 비율
export const HEAT_AURA_SPEED_PENALTY = 0.8;     // 열기 이속 비율 (×0.8 = -20%)

// ─── 자원순환 ───

export const ASH_TO_SOIL_TICKS = 20;            // Ash→Soil 전환 (20틱 = 5초)
export const SOIL_GROWTH_TICKS = 24;            // 흙+물→나무 성장 (24틱 = 6초)
export const DAMP_GROWTH_TICKS = 12;            // 진흙+물→나무 성장 (12틱 = 3초, 2배속)
export const GROWTH_WATER_COST = 0.5;           // 나무 성장 시 물 mass 소모
export const FREEZE_KILL_TICKS = 32;            // 얼음에 의한 나무 동사 (32틱 = 8초)
export const WOOD_WATER_CONSUME_PER_TICK = 0.03; // 나무가 틱당 소모하는 물 mass (느린 흡수)
export const WOOD_WATER_SPREAD_PER_TICK = 0.05;  // 나무가 인접 빈 타일로 전파하는 물 mass/틱
export const WOOD_WATER_SPREAD_INTERVAL = 8;     // 물 전파 주기 (8틱 = 2초마다)
export const WOOD_WATER_SPREAD_MIN_SOURCE = 1.0; // 전파 가능한 최소 원천 물 mass
export const WOOD_DROUGHT_TICKS = 40;            // 물 없이 40틱(10초) → 건조 상태
export const DRY_WOOD_COMBUSTIBILITY = 16;       // 건조 나무 가연성 (일반 8의 2배)
export const DRY_WOOD_IGNITION_TEMP = 100;      // 마른 나무 점화 온도 (일반 200T의 절반)
export const STEAM_CONDENSE_RATIO = 0.3;        // 증기→물 응결 시 mass 복귀 비율

// ─── 죽은땅 & 깊이 시스템 ───

export const DEPTH_DEEP_THRESHOLD = 2;            // 이 이상이면 "깊은" 지형 → 영구 물웅덩이
export const DEAD_LAND_POOL_TICKS = 8;            // 죽은땅(깊음)+물 → 영구 물웅덩이 전환 (8틱 = 2초)
export const DEAD_LAND_GROW_TICKS = 16;           // 죽은땅(얕음)+물 → 식물 성장 (16틱 = 4초)
export const PERMANENT_POOL_MASS = 8;             // 영구 물웅덩이 초기 mass
export const PLANT_WATER_CONSUME_MULTIPLIER = 2.5;// 식물의 물 소모 배율 (기본 대비, 자원순환 가속)

// ─── 열용량 계수 ───

export const HEAT_CAPACITY: Record<string, number> = {
  wood: 0.8,
  metal: 1.0,
  soil: 1.5,
  sand: 1.5,
  water: 3.0,
};

// ─── 소멸 기준 ───

export const MASS_DESTROY_THRESHOLD = 0.1;     // 질량이 이 이하면 소멸
export const WOOD_BURN_MASS_LOSS = 0.15;       // Burning 상태 틱당 질량 감소 (0.5→0.15, 불이 더 오래 탐)
export const WOOD_SMOLDER_MASS_LOSS = 0.1;     // Smoldering 상태 틱당

// ─── 색상 매핑 ───

export const STATE_COLORS: Record<string, string> = {
  normal: '#888888',
  damp: '#5588aa',
  heating: '#cc8833',
  burning: '#ff4400',
  smoldering: '#993300',
  charcoal: '#333333',
  ash: '#aaaaaa',
  heated: '#ff6600',
  molten: '#ff2200',
  brittle: '#6688cc',
  dry: '#bbaa66',
  baked: '#aa7744',
  ceramic: '#dd9966',
  frozen: '#aaddff',
  steam: '#ddeeff',
  dispersed: '#ffffff',
};

export const MATERIAL_COLORS: Record<string, string> = {
  wood: '#8B5E3C',
  metal: '#A0A0B0',
  soil: '#6B4226',
  sand: '#C2B280',
  water: '#3388CC',
};
