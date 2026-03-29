/**
 * 육각 타일(Hex Grid) 좌표 유틸리티
 * - Pointy-top 방향, odd-r offset 좌표계
 * - grid[row][col] 2D 배열 유지
 */

// ─── 타입 ───

export interface HexCoord {
  col: number;
  row: number;
}

export interface HexMetrics {
  size: number;       // hex 반지름 (중심→꼭짓점)
  width: number;      // sqrt(3) * size
  height: number;     // 2 * size
  colWidth: number;   // = width (열 간 수평 간격)
  rowHeight: number;  // = height * 3/4 (행 간 수직 간격)
}

// ─── 메트릭 ───

export function hexMetrics(size: number): HexMetrics {
  const width = Math.sqrt(3) * size;
  const height = 2 * size;
  return {
    size,
    width,
    height,
    colWidth: width,
    rowHeight: height * 0.75,
  };
}

// ─── 이웃 (odd-r offset, pointy-top) ───

// 짝수 행 (row % 2 === 0)
const EVEN_NEIGHBORS = [
  { dc: 1, dr: 0 },   // 우
  { dc: 0, dr: -1 },  // 우상
  { dc: -1, dr: -1 }, // 좌상
  { dc: -1, dr: 0 },  // 좌
  { dc: -1, dr: 1 },  // 좌하
  { dc: 0, dr: 1 },   // 우하
];

// 홀수 행 (row % 2 === 1)
const ODD_NEIGHBORS = [
  { dc: 1, dr: 0 },   // 우
  { dc: 1, dr: -1 },  // 우상
  { dc: 0, dr: -1 },  // 좌상
  { dc: -1, dr: 0 },  // 좌
  { dc: 0, dr: 1 },   // 좌하
  { dc: 1, dr: 1 },   // 우하
];

/** 6방향 이웃 좌표 반환 (경계 체크 없음) */
export function hexNeighbors(col: number, row: number): HexCoord[] {
  const offsets = row & 1 ? ODD_NEIGHBORS : EVEN_NEIGHBORS;
  return offsets.map(o => ({ col: col + o.dc, row: row + o.dr }));
}

/** 6방향 이웃 좌표 반환 (경계 체크 포함) */
export function hexNeighborsBounded(col: number, row: number, maxCol: number, maxRow: number): HexCoord[] {
  return hexNeighbors(col, row).filter(
    h => h.col >= 0 && h.row >= 0 && h.col < maxCol && h.row < maxRow
  );
}

// ─── 그리드 좌표 ↔ 픽셀 좌표 (렌더링용) ───

/** 그리드(col, row) → 픽셀 중심점 */
export function hexToPixel(col: number, row: number, m: HexMetrics): { px: number; py: number } {
  const px = m.colWidth * col + (row & 1 ? m.colWidth * 0.5 : 0);
  const py = m.rowHeight * row;
  return { px, py };
}

/** 픽셀 → 가장 가까운 그리드(col, row) */
export function pixelToHex(px: number, py: number, m: HexMetrics): HexCoord {
  // 대략적인 행 추정
  const approxRow = py / m.rowHeight;
  const row = Math.round(approxRow);

  // 해당 행의 x 오프셋 보정
  const xOffset = row & 1 ? m.colWidth * 0.5 : 0;
  const approxCol = (px - xOffset) / m.colWidth;
  const col = Math.round(approxCol);

  // 주변 후보 중 가장 가까운 hex 선택 (정밀 보정)
  let bestCol = col, bestRow = row;
  let bestDist = Infinity;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const cr = row + dr;
      const cc = col + dc;
      const center = hexToPixel(cc, cr, m);
      const dist = (center.px - px) ** 2 + (center.py - py) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestCol = cc;
        bestRow = cr;
      }
    }
  }

  return { col: bestCol, row: bestRow };
}

// ─── 월드 좌표 (엔티티 float) ↔ 그리드 좌표 ───
//
// 엔티티는 float (x, y) 공간에서 움직인다.
// 월드 좌표 = 그리드 좌표와 같은 단위 (col ≈ x, row ≈ y)
// 단, 홀수 행의 시각적 오프셋은 렌더링 시에만 적용.
// worldToHex는 float 좌표에서 가장 가까운 그리드 셀을 반환.

/** 엔티티 float 좌표 → 그리드 셀 (Math.floor 기반) */
export function worldToHex(wx: number, wy: number): HexCoord {
  const row = Math.floor(wy);
  const xAdj = wx - (row & 1 ? 0.5 : 0);
  const col = Math.floor(xAdj);
  return {
    col: Math.max(0, col),
    row: Math.max(0, row),
  };
}

/** 그리드 셀 → 월드 좌표 (셀 중심점) */
export function hexToWorld(col: number, row: number): { x: number; y: number } {
  return {
    x: col + (row & 1 ? 0.5 : 0),
    y: row,
  };
}

// ─── 거리 ───

/** offset → axial 변환 (내부용) */
function offsetToAxial(col: number, row: number): { q: number; r: number } {
  const q = col - (row - (row & 1)) / 2;
  const r = row;
  return { q, r };
}

/** 두 hex 사이의 거리 (타일 수) */
export function hexDistance(c1: number, r1: number, c2: number, r2: number): number {
  const a = offsetToAxial(c1, r1);
  const b = offsetToAxial(c2, r2);
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

// ─── 범위 탐색 ───

/** 중심에서 radius 이내의 모든 hex 좌표 */
export function hexesInRange(col: number, row: number, radius: number, maxCol: number, maxRow: number): HexCoord[] {
  const result: HexCoord[] = [];
  const center = offsetToAxial(col, row);

  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      const q = center.q + dq;
      const r = center.r + dr;
      // axial → offset
      const c = q + (r - (r & 1)) / 2;
      if (c >= 0 && c < maxCol && r >= 0 && r < maxRow) {
        result.push({ col: Math.round(c), row: r });
      }
    }
  }
  return result;
}

// ─── 렌더링 헬퍼 ───

/** hex 6꼭짓점 좌표 (pointy-top) */
export function hexCorners(cx: number, cy: number, size: number): Array<{ x: number; y: number }> {
  const corners: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30); // pointy-top: -30도부터
    corners.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    });
  }
  return corners;
}

/** Canvas에 hex 경로 생성 (fill/stroke는 호출 측에서) */
export function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** 월드 좌표 → 렌더링 픽셀 좌표 (엔티티용, float 입력 지원)
 *  엔티티는 연속 float 공간에서 이동하므로 hex 행 오프셋을 적용하지 않는다.
 *  단순 선형 변환만 사용하여 좌표 불연속(튕김)을 방지한다.
 */
export function worldToPixel(wx: number, wy: number, m: HexMetrics): { px: number; py: number } {
  return {
    px: m.colWidth * wx,
    py: m.rowHeight * wy,
  };
}
