/**
 * 설정 시스템 — localStorage 기반 유저 설정 저장/로드
 * AI 난이도, 색맹 모드, 사운드, 그래픽, 게임 속도 등 통합 관리
 */

import { setSfxVolume, setBGMVolume, setMuted } from './sound-manager.js';

// ─── AI 난이도 ───

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export interface AIDifficultyConfig {
  label: string;
  icon: string;
  tickInterval: number;       // AI 의사결정 주기 (초)
  skillUseChance: number;     // 스킬 사용 확률 (0~1)
  ultSearchRange: number;     // 궁극기 판단 범위 (타일)
  itemSearchRange: number;    // 아이템 탐색 범위 (타일)
  kitingPrecisionMin: number; // 카이팅 정밀도 min (0~1)
  kitingPrecisionMax: number; // 카이팅 정밀도 max (0~1)
  coopBonus: number;          // 협동 타겟 보너스
  strategySwitchMin: number;  // 전략 재평가 주기 min (초)
  strategySwitchMax: number;  // 전략 재평가 주기 max (초)
  idleChance: number;         // 실수(멍때림) 확률 (0~1)
  tileAwareness: number;      // 타일 속성 인식도 (0=무시, 0.5=부분, 1.0=완전)
  tileSearchRange: number;    // 유리한 타일 탐색 범위 (타일)
  avoidWeaknessTile: boolean; // 상극 타일 회피 여부
  seekBuffTile: boolean;      // 동일 속성 타일 적극 탐색 여부
  fireAvoidSmart: boolean;    // 불 회피 시 속성 고려 (fire=면역 인식)
  // ─── 시야 활용 ───
  visionExplore: boolean;     // 미탐험 지역 탐색 여부
  visionExploreWeight: number; // 탐험 우선도 (0=무시, 1=최우선)
  visionAwareTarget: boolean; // 시야 밖 적 무시 (true=시야 내만 타겟)
  visionAwareGoal: boolean;   // 거점 선택 시 시야 고려
}

export const AI_DIFFICULTY_PRESETS: Record<AIDifficulty, AIDifficultyConfig> = {
  easy: {
    label: '쉬움', icon: '⭐',
    tickInterval: 0.5,
    skillUseChance: 0.4,
    ultSearchRange: 5,
    itemSearchRange: 6,
    kitingPrecisionMin: 0.3,
    kitingPrecisionMax: 0.5,
    coopBonus: 10,
    strategySwitchMin: 15,
    strategySwitchMax: 30,
    idleChance: 0.3,
    tileAwareness: 0,        // 타일 속성 무시 — 불이건 물이건 상관없이 이동
    tileSearchRange: 0,
    avoidWeaknessTile: false,
    seekBuffTile: false,
    fireAvoidSmart: false,    // 속성 구분 없이 무조건 불 회피
    visionExplore: false,     // 쉬움: 탐험 안 함 — 그냥 직진
    visionExploreWeight: 0,
    visionAwareTarget: false, // 시야 밖 적도 감지 (전지적 시점)
    visionAwareGoal: false,
  },
  normal: {
    label: '보통', icon: '⭐⭐',
    tickInterval: 0.25,
    skillUseChance: 0.7,
    ultSearchRange: 8,
    itemSearchRange: 12,
    kitingPrecisionMin: 0.4,
    kitingPrecisionMax: 0.7,
    coopBonus: 30,
    strategySwitchMin: 8,
    strategySwitchMax: 23,
    idleChance: 0,
    tileAwareness: 0.5,      // 발밑 상극 타일은 피하지만 적극 탐색은 안 함
    tileSearchRange: 5,
    avoidWeaknessTile: true,
    seekBuffTile: false,
    fireAvoidSmart: true,     // 불 속성은 불 타일 안 피함
    visionExplore: true,      // 보통: 비전투 시 미탐험 지역 탐색
    visionExploreWeight: 0.3, // 탐험 < 거점 < 적
    visionAwareTarget: true,  // 시야 내 적만 타겟
    visionAwareGoal: false,   // 거점은 위치 알고 있음
  },
  hard: {
    label: '어려움', icon: '⭐⭐⭐',
    tickInterval: 0.15,
    skillUseChance: 0.9,
    ultSearchRange: 10,
    itemSearchRange: 18,
    kitingPrecisionMin: 0.55,
    kitingPrecisionMax: 0.8,
    coopBonus: 50,
    strategySwitchMin: 5,
    strategySwitchMax: 12,
    idleChance: 0,
    tileAwareness: 1.0,      // 완전 인식 — 유리한 타일 적극 탐색 + 상극 회피 + 길찾기 가중치
    tileSearchRange: 10,
    avoidWeaknessTile: true,
    seekBuffTile: true,       // 비전투 시 동일 속성 타일로 이동해 버프 충전
    fireAvoidSmart: true,
    visionExplore: true,      // 어려움: 전략적 탐험 — 거점 방향 우선 탐색
    visionExploreWeight: 0.6, // 탐험 우선도 높음 (초반에 맵 장악)
    visionAwareTarget: true,  // 시야 내 적만 타겟
    visionAwareGoal: true,    // 탐험된 거점만 우선 점령
  },
};

// ─── 색맹 모드 ───

export type ColorMode = 'default' | 'colorblind';

export interface ColorPalette {
  teamA: string;
  teamB: string;
  teamALight: string;
  teamBLight: string;
  teamADark: string;
  teamBDark: string;
  teamAMarker: string; // ● or ◆
  teamBMarker: string;
}

export const COLOR_PALETTES: Record<ColorMode, ColorPalette> = {
  default: {
    teamA: '#44ee44', teamB: '#ee4444',
    teamALight: '#88ff88', teamBLight: '#ff8888',
    teamADark: '#227722', teamBDark: '#772222',
    teamAMarker: '●', teamBMarker: '●',
  },
  colorblind: {
    teamA: '#4488ff', teamB: '#ff8800',
    teamALight: '#88bbff', teamBLight: '#ffbb44',
    teamADark: '#224488', teamBDark: '#884400',
    teamAMarker: '●', teamBMarker: '◆',
  },
};

// ─── 게임 설정 인터페이스 ───

export type LangCode = 'ko' | 'en' | 'ja' | 'zh';

export interface GameSettings {
  // 사운드
  sfxVolume: number;    // 0~1
  bgmVolume: number;    // 0~1
  muted: boolean;
  // 그래픽
  colorMode: ColorMode;
  fontSize: number;     // 0.8 ~ 1.4 배율
  // 게임
  aiDifficulty: AIDifficulty;
  gameSpeed: number;    // 0.5, 1.0, 1.5
  language: LangCode;   // 언어
  // 키 힌트
  showKeyHints: boolean;       // 상시 표시 여부
  keyHintsShownOnce: boolean;  // 10초 힌트 이미 표시했는지
  // 튜토리얼
  tutorialCompleted: boolean;
  tutorialOffered: boolean;    // 첫 방문 제안 여부
}

const DEFAULT_SETTINGS: GameSettings = {
  sfxVolume: 0.3,
  bgmVolume: 0.18,
  muted: false,
  colorMode: 'default',
  fontSize: 1.0,
  aiDifficulty: 'normal',
  gameSpeed: 1.0,
  language: 'ko',
  showKeyHints: false,
  keyHintsShownOnce: false,
  tutorialCompleted: false,
  tutorialOffered: false,
};

const LANG_LABELS: Record<LangCode, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '中文',
};
const SUPPORTED_LANGS: LangCode[] = ['ko', 'en'];

const STORAGE_KEY = 'ashcycle_settings';

// ─── 싱글톤 설정 ───

let settings: GameSettings = { ...DEFAULT_SETTINGS };

export function getSettings(): GameSettings {
  return settings;
}

export function updateSettings(partial: Partial<GameSettings>): void {
  Object.assign(settings, partial);
  applySettings();
  saveSettings();
}

export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch { /* localStorage 사용 불가 시 기본값 유지 */ }
  applySettings();
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* 무시 */ }
}

function applySettings(): void {
  setSfxVolume(settings.sfxVolume);
  setBGMVolume(settings.bgmVolume);
  setMuted(settings.muted);
}

// ─── 현재 AI 난이도 config 가져오기 ───

export function getAIDifficultyConfig(): AIDifficultyConfig {
  return AI_DIFFICULTY_PRESETS[settings.aiDifficulty];
}

// ─── 현재 색상 팔레트 가져오기 ───

export function getColorPalette(): ColorPalette {
  return COLOR_PALETTES[settings.colorMode];
}

// ─── 설정 UI 렌더링 ───

export interface SettingsRenderContext {
  ctx: CanvasRenderingContext2D;
  canvasW: number;
  canvasH: number;
}

let settingsOpen = false;
let onLanguageChangeCallback: ((lang: LangCode) => void) | null = null;

/** 클라이언트에서 언어 변경 콜백 등록 (i18n setLanguage 연동) */
export function setOnLanguageChange(cb: (lang: LangCode) => void): void {
  onLanguageChangeCallback = cb;
}

export function isSettingsOpen(): boolean { return settingsOpen; }
export function openSettings(): void { settingsOpen = true; }
export function closeSettings(): void { settingsOpen = false; }
export function toggleSettings(): void { settingsOpen = !settingsOpen; }

export function renderSettings(rc: SettingsRenderContext): void {
  if (!settingsOpen) return;
  const { ctx, canvasW, canvasH } = rc;

  // 배경 오버레이
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, canvasW, canvasH);

  const panelW = Math.min(420, canvasW - 40);
  const panelH = Math.min(500, canvasH - 40);
  const px = (canvasW - panelW) / 2;
  const py = (canvasH - panelH) / 2;

  // 패널
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(px, py, panelW, panelH);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, panelW, panelH);

  // 타이틀
  ctx.fillStyle = '#ffcc44';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('⚙️ 설정', canvasW / 2, py + 28);

  const leftX = px + 20;
  const rightX = px + panelW - 20;
  let cy = py + 50;
  const rowH = 36;

  // ─── 사운드 섹션 ───
  drawSectionHeader(ctx, leftX, cy, '🔊 사운드');
  cy += 20;
  drawSliderRow(ctx, leftX, rightX, cy, 'SFX 볼륨', settings.sfxVolume, panelW - 40);
  cy += rowH;
  drawSliderRow(ctx, leftX, rightX, cy, 'BGM 볼륨', settings.bgmVolume, panelW - 40);
  cy += rowH;

  // ─── 그래픽 섹션 ───
  drawSectionHeader(ctx, leftX, cy, '🎨 그래픽');
  cy += 20;
  drawOptionRow(ctx, leftX, rightX, cy, '색상 모드',
    settings.colorMode === 'default' ? '기본 🟢🔴' : '색맹 🔵🟠');
  cy += rowH;
  drawSliderRow(ctx, leftX, rightX, cy, '글꼴 크기', (settings.fontSize - 0.8) / 0.6, panelW - 40);
  cy += rowH;

  // ─── 게임 섹션 ───
  drawSectionHeader(ctx, leftX, cy, '🎮 게임');
  cy += 20;
  const aiCfg = AI_DIFFICULTY_PRESETS[settings.aiDifficulty];
  drawOptionRow(ctx, leftX, rightX, cy, 'AI 난이도', `${aiCfg.icon} ${aiCfg.label}`);
  cy += rowH;
  drawOptionRow(ctx, leftX, rightX, cy, '게임 속도',
    settings.gameSpeed === 0.5 ? '0.5x 느리게' :
    settings.gameSpeed === 1.5 ? '1.5x 빠르게' : '1.0x 보통');
  cy += rowH;
  drawOptionRow(ctx, leftX, rightX, cy, '🌐 언어', LANG_LABELS[settings.language] || settings.language);
  cy += rowH;

  // ─── 접근성 ───
  drawSectionHeader(ctx, leftX, cy, '♿ 접근성');
  cy += 20;
  drawToggleRow(ctx, leftX, rightX, cy, '키 힌트 상시 표시', settings.showKeyHints);
  cy += rowH;

  // 닫기 버튼
  const closeBtnY = py + panelH - 40;
  ctx.fillStyle = '#553333';
  ctx.fillRect(canvasW / 2 - 50, closeBtnY, 100, 30);
  ctx.strokeStyle = '#555';
  ctx.strokeRect(canvasW / 2 - 50, closeBtnY, 100, 30);
  ctx.fillStyle = '#ddd';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('닫기 (ESC)', canvasW / 2, closeBtnY + 20);
  ctx.textAlign = 'left';
}

function drawSectionHeader(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  ctx.fillStyle = '#888';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y + 10);
  // 구분선
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 15);
  ctx.lineTo(x + 350, y + 15);
  ctx.stroke();
}

function drawSliderRow(ctx: CanvasRenderingContext2D, lx: number, rx: number, y: number, label: string, value: number, sliderW: number) {
  ctx.fillStyle = '#ccc';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, lx, y + 12);

  // 슬라이더 트랙
  const slX = lx + 100;
  const slW = Math.min(150, sliderW - 140);
  const slY = y + 7;
  ctx.fillStyle = '#333';
  ctx.fillRect(slX, slY, slW, 6);
  // 슬라이더 값
  ctx.fillStyle = '#4488ff';
  ctx.fillRect(slX, slY, slW * Math.max(0, Math.min(1, value)), 6);
  // 핸들
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(slX + slW * Math.max(0, Math.min(1, value)), slY + 3, 5, 0, Math.PI * 2);
  ctx.fill();
  // 값 텍스트
  ctx.fillStyle = '#aaa';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(value * 100)}%`, rx, y + 12);
  ctx.textAlign = 'left';
}

function drawOptionRow(ctx: CanvasRenderingContext2D, lx: number, rx: number, y: number, label: string, value: string) {
  ctx.fillStyle = '#ccc';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, lx, y + 12);

  // 좌우 화살표 + 값
  ctx.fillStyle = '#4488ff';
  ctx.textAlign = 'center';
  const cx = (lx + rx) / 2 + 50;
  ctx.fillText(`◀  ${value}  ▶`, cx, y + 12);
  ctx.textAlign = 'left';
}

function drawToggleRow(ctx: CanvasRenderingContext2D, lx: number, rx: number, y: number, label: string, on: boolean) {
  ctx.fillStyle = '#ccc';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, lx, y + 12);

  // 토글
  const tx = rx - 40;
  ctx.fillStyle = on ? '#44aa44' : '#555';
  ctx.fillRect(tx, y + 3, 30, 14);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(on ? tx + 23 : tx + 7, y + 10, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'left';
}

// ─── 설정 클릭 처리 ───

export function handleSettingsClick(x: number, y: number, canvasW: number, canvasH: number): boolean {
  if (!settingsOpen) return false;

  const panelW = Math.min(420, canvasW - 40);
  const panelH = Math.min(500, canvasH - 40);
  const px = (canvasW - panelW) / 2;
  const py = (canvasH - panelH) / 2;

  // 패널 바깥 클릭 → 닫기
  if (x < px || x > px + panelW || y < py || y > py + panelH) {
    closeSettings();
    return true;
  }

  const leftX = px + 20;
  const rightX = px + panelW - 20;
  const rowH = 36;

  // 각 행의 y좌표 계산
  let cy = py + 70; // SFX 볼륨
  const slX = leftX + 100;
  const slW = Math.min(150, panelW - 180);

  // SFX 볼륨 슬라이더
  if (y >= cy && y <= cy + 20 && x >= slX && x <= slX + slW) {
    updateSettings({ sfxVolume: Math.max(0, Math.min(1, (x - slX) / slW)) });
    return true;
  }
  cy += rowH;

  // BGM 볼륨 슬라이더
  if (y >= cy && y <= cy + 20 && x >= slX && x <= slX + slW) {
    updateSettings({ bgmVolume: Math.max(0, Math.min(1, (x - slX) / slW)) });
    return true;
  }
  cy += rowH;

  // 색상 모드 섹션 헤더 + 20
  cy += 20;
  // 색상 모드 토글
  if (y >= cy && y <= cy + 20) {
    updateSettings({ colorMode: settings.colorMode === 'default' ? 'colorblind' : 'default' });
    return true;
  }
  cy += rowH;

  // 글꼴 크기 슬라이더
  if (y >= cy && y <= cy + 20 && x >= slX && x <= slX + slW) {
    const val = 0.8 + Math.max(0, Math.min(1, (x - slX) / slW)) * 0.6;
    updateSettings({ fontSize: Math.round(val * 10) / 10 });
    return true;
  }
  cy += rowH;

  // 게임 섹션 헤더 + 20
  cy += 20;
  // AI 난이도
  if (y >= cy && y <= cy + 20) {
    const diffs: AIDifficulty[] = ['easy', 'normal', 'hard'];
    const idx = diffs.indexOf(settings.aiDifficulty);
    updateSettings({ aiDifficulty: diffs[(idx + 1) % diffs.length] });
    return true;
  }
  cy += rowH;

  // 게임 속도
  if (y >= cy && y <= cy + 20) {
    const speeds = [0.5, 1.0, 1.5];
    const idx = speeds.indexOf(settings.gameSpeed);
    updateSettings({ gameSpeed: speeds[(idx + 1) % speeds.length] });
    return true;
  }
  cy += rowH;

  // 언어
  if (y >= cy && y <= cy + 20) {
    const idx = SUPPORTED_LANGS.indexOf(settings.language);
    const newLang = SUPPORTED_LANGS[(idx + 1) % SUPPORTED_LANGS.length];
    updateSettings({ language: newLang });
    if (onLanguageChangeCallback) onLanguageChangeCallback(newLang);
    return true;
  }
  cy += rowH;

  // 접근성 섹션 헤더 + 20
  cy += 20;
  // 키 힌트 토글
  if (y >= cy && y <= cy + 20) {
    updateSettings({ showKeyHints: !settings.showKeyHints });
    return true;
  }
  cy += rowH;

  // 닫기 버튼
  const closeBtnY = py + panelH - 40;
  if (x >= canvasW / 2 - 50 && x <= canvasW / 2 + 50 && y >= closeBtnY && y <= closeBtnY + 30) {
    closeSettings();
    return true;
  }

  return true; // 패널 내부 클릭은 소비
}
