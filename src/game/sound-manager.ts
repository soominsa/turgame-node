/**
 * sound-manager 스텁 — 서버 환경용
 * 브라우저 전용 사운드 API를 서버에서 import해도 크래시하지 않도록 no-op 제공
 */

export function setSfxVolume(_v: number): void {}
export function setBGMVolume(_v: number): void {}
export function setMuted(_m: boolean): void {}
export function playSfx(_name: string): void {}
export function playBGM(_name: string, _volume?: number): void {}
export function stopBGM(): void {}
