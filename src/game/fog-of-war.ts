/**
 * 전장의 안개 (Fog of War) 시스템
 *
 * 타일 상태 3단계:
 *  0 = 미탐험 (완전 어둠)
 *  1 = 탐험됨 (반투명 어둠 — 한번이라도 시야에 들어왔던 타일)
 *  2 = 가시 (완전 밝음 — 현재 아군 시야 내)
 *
 * GameEngine과 독립적. 렌더러에 Uint8Array를 넘겨 오버레이 처리.
 */

import { worldToHex, hexToWorld, hexDistance } from '../core/hex.js';

export type FogTileState = 0 | 1 | 2;

export class FogOfWar {
  readonly fieldW: number;
  readonly fieldH: number;
  readonly sightRange: number;

  /** 현재 프레임 타일 상태 (0/1/2). fieldH × fieldW flat array. */
  private tiles: Uint8Array;
  /** 영구 탐험 기록 (0 or 1). */
  private explored: Uint8Array;
  /** 가시 타일 해시 — 변경 감지용 */
  private lastVisHash = '';
  /** dirty 플래그 (렌더러가 다시 그려야 하는지) */
  dirty = true;

  constructor(fieldW: number, fieldH: number, sightRange = 6) {
    this.fieldW = fieldW;
    this.fieldH = fieldH;
    this.sightRange = sightRange;
    const total = fieldW * fieldH;
    this.tiles = new Uint8Array(total);     // 0 = unexplored
    this.explored = new Uint8Array(total);  // 0 = never seen
  }

  /** 매 프레임 호출. 아군 엔티티 위치+개별 시야 범위로 시야 갱신. */
  update(allyPositions: ReadonlyArray<{ x: number; y: number; visionRange?: number }>) {
    const { fieldW, fieldH, sightRange, tiles, explored } = this;
    const total = fieldW * fieldH;

    // 이전 visible(2) → explored(1)로 다운그레이드
    for (let i = 0; i < total; i++) {
      if (tiles[i] === 2) tiles[i] = 1;
      // explored 유지
      if (explored[i]) tiles[i] = Math.max(tiles[i], 1) as FogTileState;
    }

    // 각 아군 위치에서 시야 범위 내 타일을 visible(2)로
    for (const pos of allyPositions) {
      const hex = worldToHex(pos.x, pos.y);
      const cr = hex.row, cc = hex.col;
      // 엔티티별 시야 범위 사용 (없으면 기본 sightRange)
      const range = pos.visionRange ?? sightRange;

      // 시야 범위 내 타일 순회 (hexDistance 기반)
      const rMin = Math.max(0, cr - range);
      const rMax = Math.min(fieldH - 1, cr + range);
      for (let r = rMin; r <= rMax; r++) {
        const cMin = Math.max(0, cc - range);
        const cMax = Math.min(fieldW - 1, cc + range);
        for (let c = cMin; c <= cMax; c++) {
          if (hexDistance(cc, cr, c, r) <= range) {
            const idx = r * fieldW + c;
            tiles[idx] = 2;
            explored[idx] = 1;
          }
        }
      }
    }

    // 변경 감지 (간이 해시: visible 타일 수)
    let vis = 0;
    for (let i = 0; i < total; i++) if (tiles[i] === 2) vis++;
    const hash = `${vis}`;
    if (hash !== this.lastVisHash) {
      this.lastVisHash = hash;
      this.dirty = true;
    }
  }

  /** 타일 상태 배열 반환 (렌더러용). */
  getTileStates(): Uint8Array { return this.tiles; }

  /** 특정 그리드 좌표의 상태. */
  getState(col: number, row: number): FogTileState {
    if (col < 0 || col >= this.fieldW || row < 0 || row >= this.fieldH) return 0;
    return this.tiles[row * this.fieldW + col] as FogTileState;
  }

  /** 월드 좌표가 현재 가시 범위인지. */
  isVisible(wx: number, wy: number): boolean {
    const h = worldToHex(wx, wy);
    return this.getState(h.col, h.row) === 2;
  }

  /** 월드 좌표가 탐험된 적 있는지. */
  isExplored(wx: number, wy: number): boolean {
    const h = worldToHex(wx, wy);
    const s = this.getState(h.col, h.row);
    return s >= 1;
  }

  /** 전체 초기화 (게임 재시작). */
  reset() {
    this.tiles.fill(0);
    this.explored.fill(0);
    this.lastVisHash = '';
    this.dirty = true;
  }
}
