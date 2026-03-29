/**
 * settings-ui.ts — AI 난이도 설정 (노드 서버용 경량 버전)
 *
 * 원본(central)의 settings-ui.ts에서 AI 관련 부분만 추출.
 * 노드 서버에는 UI가 없으므로 난이도 설정만 포함.
 */

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export interface AIDifficultyConfig {
  label: string;
  icon: string;
  tickInterval: number;
  skillUseChance: number;
  ultSearchRange: number;
  itemSearchRange: number;
  kitingPrecisionMin: number;
  kitingPrecisionMax: number;
  coopBonus: number;
  strategySwitchMin: number;
  strategySwitchMax: number;
  idleChance: number;
}

export const AI_DIFFICULTY_PRESETS: Record<AIDifficulty, AIDifficultyConfig> = {
  easy: {
    label: '쉬움', icon: '⭐',
    tickInterval: 0.5, skillUseChance: 0.4, ultSearchRange: 5,
    itemSearchRange: 6, kitingPrecisionMin: 0.3, kitingPrecisionMax: 0.5,
    coopBonus: 10, strategySwitchMin: 15, strategySwitchMax: 30, idleChance: 0.3,
  },
  normal: {
    label: '보통', icon: '⭐⭐',
    tickInterval: 0.25, skillUseChance: 0.7, ultSearchRange: 8,
    itemSearchRange: 12, kitingPrecisionMin: 0.4, kitingPrecisionMax: 0.7,
    coopBonus: 30, strategySwitchMin: 8, strategySwitchMax: 23, idleChance: 0,
  },
  hard: {
    label: '어려움', icon: '⭐⭐⭐',
    tickInterval: 0.15, skillUseChance: 0.9, ultSearchRange: 10,
    itemSearchRange: 18, kitingPrecisionMin: 0.55, kitingPrecisionMax: 0.8,
    coopBonus: 50, strategySwitchMin: 5, strategySwitchMax: 12, idleChance: 0,
  },
};

/** 서버 노드에서는 기본 normal 난이도 사용 */
let currentDifficulty: AIDifficulty = 'normal';

export function getAIDifficultyConfig(): AIDifficultyConfig {
  return AI_DIFFICULTY_PRESETS[currentDifficulty];
}

export function setAIDifficulty(d: AIDifficulty) {
  currentDifficulty = d;
}
