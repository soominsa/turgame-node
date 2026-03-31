/**
 * NavGrid — 내비게이션 그리드 + 길찾기 (BFS/A*)
 * GameEngine에서 분리된 독립 클래스
 */

import { Entity } from '../shared/combat-entities.js';
import { hexToWorld } from '../core/hex.js';
import { Wall, PathAlgorithm } from './game-engine-types.js';

export class NavGrid {
  static readonly NAV_SCALE = 24;

  private navGrid: Uint8Array | null = null;
  private navW = 0;
  private navH = 0;
  private navScale: number;
  private wallSet = new Set<string>();
  private wallWorldCache: Array<{ x: number; y: number }> = [];
  private pathCache = new Map<string, { path: [number, number][]; time: number }>();
  private committedPaths = new Map<string, { target: string; path: [number, number][]; time: number }>();
  private waypointIndices = new Map<string, number>(); // 엔티티별 현재 웨이포인트 인덱스 (진동 방지)
  private pathAlgorithm: PathAlgorithm;

  // 재사용 버퍼 (BFS/A* 호출마다 new 방지)
  private _bfsPrev: Int32Array | null = null;
  private _bfsVisited: Uint8Array | null = null;
  private _bfsQueue: Int32Array | null = null;
  private _astarGScore: Float32Array | null = null;
  private _astarPrev: Int32Array | null = null;
  private _astarClosed: Uint8Array | null = null;
  private _bufferSize = 0;

  constructor(pathAlgorithm: PathAlgorithm = 'bfs', navScale = 0) {
    this.pathAlgorithm = pathAlgorithm;
    this.navScale = navScale > 0 ? navScale : NavGrid.NAV_SCALE;
  }

  private ensureBuffers() {
    const gridSize = this.navW * this.navH;
    if (this._bufferSize === gridSize) return;
    this._bufferSize = gridSize;
    this._bfsPrev = new Int32Array(gridSize);
    this._bfsVisited = new Uint8Array(gridSize);
    this._bfsQueue = new Int32Array(gridSize);
    this._astarGScore = new Float32Array(gridSize);
    this._astarPrev = new Int32Array(gridSize);
    this._astarClosed = new Uint8Array(gridSize);
  }

  // ─── 초기화 ───

  build(walls: Wall[], fieldW: number, fieldH: number) {
    this.wallSet.clear();
    this.wallWorldCache = [];
    this.pathCache.clear();
    this.committedPaths.clear();

    for (const w of walls) {
      this.wallSet.add(`${w.x},${w.y}`);
      this.wallWorldCache.push(hexToWorld(w.x, w.y));
    }

    this.buildNavGrid(walls, fieldW, fieldH);
  }

  // ─── 벽 체크 ───

  /** 월드 float 좌표가 차단 셀인지 */
  isWallAtHex(wx: number, wy: number): boolean {
    if (!this.navGrid) return this.wallSet.has(`${Math.floor(wx)},${Math.floor(wy)}`);
    const S = this.navScale;
    const nx = Math.floor(wx * S);
    const ny = Math.floor(wy * S);
    if (nx < 0 || ny < 0 || nx >= this.navW || ny >= this.navH) return true;
    return this.navGrid[ny * this.navW + nx] === 1;
  }

  /** 월드 좌표의 점이 벽 hex 안에 있는지 */
  isWallAtWorld(wx: number, wy: number): boolean {
    return this.isWallAtHex(wx, wy);
  }

  /** 타일 좌표로 벽 체크 (Set 기반 O(1)) */
  isWallAt(x: number, y: number): boolean {
    return this.wallSet.has(`${x},${y}`);
  }

  /** 엔티티 원(cx, cy, radius)이 어떤 벽 hex와 겹치는지 체크 */
  collidesWithWall(cx: number, cy: number, radius: number): boolean {
    const wallR = 0.35;
    const threshold = wallR + radius;
    const thresholdSq = threshold * threshold;
    for (const wc of this.wallWorldCache) {
      const dx = cx - wc.x, dy = cy - wc.y;
      if (dx * dx + dy * dy < thresholdSq) return true;
    }
    return false;
  }

  /** nav 그리드에서 해당 셀이 통행 가능한지 */
  navPassable(nx: number, ny: number): boolean {
    if (nx < 0 || ny < 0 || nx >= this.navW || ny >= this.navH) return false;
    return this.navGrid![ny * this.navW + nx] === 0;
  }

  // ─── LOS ───

  hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const steps = Math.max(2, Math.ceil(dist * 2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isWallAtHex(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
    }
    return true;
  }

  // ─── 벽 탈출 ───

  /** 벽 안에 끼인 엔티티를 가장 가까운 빈 곳으로 이동 */
  escapeWall(e: Entity) {
    if (!this.isWallAtHex(e.x, e.y)) return;
    const S = this.navScale;
    const cnx = Math.floor(e.x * S), cny = Math.floor(e.y * S);
    for (let r = 1; r <= S * 2; r++) {
      let found = false;
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (this.navPassable(cnx + dx, cny + dy)) {
            e.x = (cnx + dx + 0.5) / S;
            e.y = (cny + dy + 0.5) / S;
            found = true;
          }
        }
      }
      if (found) break;
    }
  }

  // ─── 길찾기 ───

  findPathBFS(sx: number, sy: number, tx: number, ty: number, time: number): [number, number][] | null {
    if (!this.navGrid) return null;
    const S = this.navScale;

    let snx = Math.floor(sx * S), sny = Math.floor(sy * S);
    let enx = Math.floor(tx * S), eny = Math.floor(ty * S);
    if (snx === enx && sny === eny) return [[tx, ty]];

    // 시작점이 벽 안이면 가까운 빈 곳 찾기
    if (!this.navPassable(snx, sny)) {
      let found = false;
      for (let r = 1; r <= S && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (this.navPassable(snx + dx, sny + dy)) {
              snx += dx; sny += dy; found = true;
            }
          }
        }
      }
      if (!found) return null;
    }

    // 도착점이 벽 안이면 가까운 빈 곳 찾기
    if (!this.navPassable(enx, eny)) {
      let found = false;
      for (let r = 1; r <= S && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (this.navPassable(enx + dx, eny + dy)) {
              enx += dx; eny += dy; found = true;
            }
          }
        }
      }
      if (!found) return null;
    }

    const key = `${snx},${sny}-${enx},${eny}`;
    const cached = this.pathCache.get(key);
    if (cached && time - cached.time < 2.0) return cached.path;

    const prev = this.pathAlgorithm === 'astar'
      ? this.runAStar(snx, sny, enx, eny)
      : this.runBFS(snx, sny, enx, eny);

    if (!prev) return null;

    // 역추적 → nav 경로
    const startIdx = sny * this.navW + snx;
    const endIdx = eny * this.navW + enx;
    const navPath: [number, number][] = [];
    let ci = endIdx;
    while (ci !== -1 && ci !== startIdx) {
      navPath.unshift([ci % this.navW, Math.floor(ci / this.navW)]);
      ci = prev[ci];
    }

    // nav → 월드 웨이포인트
    const path: [number, number][] = [];
    const step = Math.max(1, Math.floor(S / 2));
    for (let i = 0; i < navPath.length; i += step) {
      const [nx, ny] = navPath[i];
      path.push([(nx + 0.5) / S, (ny + 0.5) / S]);
    }
    path.push([tx, ty]);

    this.pathCache.set(key, { path, time });
    if (this.pathCache.size > 50) this.pathCache.delete(this.pathCache.keys().next().value!);
    return path;
  }

  // ─── 이동 ───

  moveToward(e: Entity, tx: number, ty: number, time: number) {
    const dx = tx - e.x, dy = ty - e.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.3) { e.vx = 0; e.vy = 0; return; }

    // committed path: 키를 2배 해상도로 만들어 작은 이동에 의한 캐시 미스 방지
    const targetKey = `${Math.floor(tx * 2)},${Math.floor(ty * 2)}`;
    const committed = this.committedPaths.get(e.id);
    let path: [number, number][] | null = null;
    let pathChanged = false;
    if (committed && committed.target === targetKey && time - committed.time < 5) {
      path = committed.path;
    } else {
      path = this.findPathBFS(e.x, e.y, tx, ty, time);
      if (path && path.length > 0) {
        this.committedPaths.set(e.id, { target: targetKey, path, time });
        pathChanged = true;
      }
    }

    if (path && path.length > 0) {
      // 웨이포인트 인덱스 추적 (진동 방지: 앞으로만 진행)
      let prevWpIdx = this.waypointIndices.get(e.id) || 0;
      if (pathChanged) prevWpIdx = 0; // 경로가 바뀌면 리셋

      // 현재 인덱스가 범위 초과 시 클램프
      if (prevWpIdx >= path.length) prevWpIdx = path.length - 1;

      // 현재 웨이포인트에 충분히 가까우면 다음으로 전진
      const [cwx, cwy] = path[prevWpIdx];
      const cwDist = (cwx - e.x) ** 2 + (cwy - e.y) ** 2;
      let wpIdx = prevWpIdx;
      if (cwDist < 0.5 * 0.5 && wpIdx < path.length - 1) {
        wpIdx++; // 다음 웨이포인트로 전진
      }

      // 혹시 더 앞 웨이포인트가 가까우면 스킵 (직선 경로 최적화, 뒤로는 안 감)
      for (let i = wpIdx + 1; i < Math.min(wpIdx + 3, path.length); i++) {
        const [fx, fy] = path[i];
        const fd = (fx - e.x) ** 2 + (fy - e.y) ** 2;
        if (fd < cwDist && this.hasLineOfSight(e.x, e.y, fx, fy)) {
          wpIdx = i;
        }
      }

      this.waypointIndices.set(e.id, wpIdx);

      const [wpx, wpy] = path[wpIdx];
      const wpDx = wpx - e.x, wpDy = wpy - e.y;
      const wpD = Math.sqrt(wpDx * wpDx + wpDy * wpDy);
      if (wpD > 0.05) { e.vx = (wpDx / wpD) * e.speed; e.vy = (wpDy / wpD) * e.speed; }
    } else {
      // BFS 실패 시 축별 우회 시도 (벽 슬라이딩)
      const vx = (dx / d) * e.speed;
      const vy = (dy / d) * e.speed;
      // 대각선 먼저 시도
      if (!this.isWallAtWorld(e.x + vx * 0.2, e.y + vy * 0.2)) {
        e.vx = vx; e.vy = vy;
      } else if (!this.isWallAtWorld(e.x + vx * 0.2, e.y)) {
        e.vx = vx; e.vy = 0;
      } else if (!this.isWallAtWorld(e.x, e.y + vy * 0.2)) {
        e.vx = 0; e.vy = vy;
      } else {
        // 벽에 완전 막힘 → 수직 방향 벽 슬라이딩 (랜덤 대신 결정론적)
        const perpX = -dy / d, perpY = dx / d;
        if (!this.isWallAtWorld(e.x + perpX * 0.3, e.y + perpY * 0.3)) {
          e.vx = perpX * e.speed * 0.7;
          e.vy = perpY * e.speed * 0.7;
        } else if (!this.isWallAtWorld(e.x - perpX * 0.3, e.y - perpY * 0.3)) {
          e.vx = -perpX * e.speed * 0.7;
          e.vy = -perpY * e.speed * 0.7;
        } else {
          e.vx = 0; e.vy = 0; // 완전히 막힘 → 정지 (도리도리보다 나음)
        }
      }
    }
  }

  /** stuckCounter가 높으면 committed path 초기화 (game-engine에서 호출) */
  resetPath(entityId: string) {
    this.committedPaths.delete(entityId);
    this.waypointIndices.delete(entityId);
  }

  moveAway(e: Entity, tx: number, ty: number, factor: number) {
    const dx = tx - e.x, dy = ty - e.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.1) return;
    let vx = -(dx / d) * e.speed * factor;
    let vy = -(dy / d) * e.speed * factor;

    if (this.isWallAtWorld(e.x + vx * 0.3, e.y)) {
      vx = 0;
      const tryUp = !this.isWallAtWorld(e.x, e.y - 1);
      const tryDown = !this.isWallAtWorld(e.x, e.y + 1);
      if (tryUp && !tryDown) vy = -e.speed * factor;
      else if (tryDown && !tryUp) vy = e.speed * factor;
      else {
        // 둘 다 열려있으면 적에서 더 먼 방향 선택 (랜덤 제거)
        const distUp = (tx - e.x) ** 2 + (ty - (e.y - 1)) ** 2;
        const distDown = (tx - e.x) ** 2 + (ty - (e.y + 1)) ** 2;
        vy = (distUp >= distDown ? -1 : 1) * e.speed * factor;
      }
    }
    if (this.isWallAtWorld(e.x, e.y + vy * 0.3)) {
      vy = 0;
      const tryLeft = !this.isWallAtWorld(e.x - 1, e.y);
      const tryRight = !this.isWallAtWorld(e.x + 1, e.y);
      if (tryLeft && !tryRight) vx = -e.speed * factor;
      else if (tryRight && !tryLeft) vx = e.speed * factor;
      else {
        // 둘 다 열려있으면 적에서 더 먼 방향 선택 (랜덤 제거)
        const distLeft = (tx - (e.x - 1)) ** 2 + (ty - e.y) ** 2;
        const distRight = (tx - (e.x + 1)) ** 2 + (ty - e.y) ** 2;
        vx = (distLeft >= distRight ? -1 : 1) * e.speed * factor;
      }
    }
    e.vx = vx; e.vy = vy;
  }

  // ─── 적 탐색 ───

  findNearestEnemy(e: Entity, entities: Entity[], visCheck?: (team: 'A' | 'B', x: number, y: number) => boolean): Entity | null {
    let best: Entity | null = null, bestDist = Infinity;
    for (const t of entities) {
      if (t.team === e.team || t.dead) continue;
      // 팀 공유 시야 체크 (visCheck 제공 시)
      if (visCheck && !visCheck(e.team, t.x, t.y)) continue;
      const d = Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2);
      if (d < bestDist && this.hasLineOfSight(e.x, e.y, t.x, t.y)) { bestDist = d; best = t; }
    }
    return best;
  }

  /** 팀 시야 내 가장 가까운 적 (벽 무시, 거리만) */
  findNearestEnemyIgnoreWalls(e: Entity, entities: Entity[], visCheck?: (team: 'A' | 'B', x: number, y: number) => boolean): Entity | null {
    let best: Entity | null = null, bestDist = Infinity;
    for (const t of entities) {
      if (t.team === e.team || t.dead) continue;
      // 팀 공유 시야 체크 (visCheck 제공 시)
      if (visCheck && !visCheck(e.team, t.x, t.y)) continue;
      const d = Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2);
      if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
  }

  // ─── Private ───

  private buildNavGrid(walls: Wall[], fieldW: number, fieldH: number) {
    const S = this.navScale;
    this.navW = fieldW * S;
    this.navH = fieldH * S;
    this.navGrid = new Uint8Array(this.navW * this.navH);

    for (const w of walls) {
      const center = hexToWorld(w.x, w.y);
      this.rasterizeHex(center.x, center.y);
    }
  }

  private rasterizeHex(cx: number, cy: number) {
    const S = this.navScale;
    const INFLATE = 0.35;
    const HW = 0.5 + INFLATE;
    const VH = 2 / 3 + INFLATE;
    const FLAT = 1 / 3 + INFLATE;

    const minNx = Math.max(0, Math.floor((cx - HW) * S));
    const maxNx = Math.min(this.navW - 1, Math.ceil((cx + HW) * S));
    const minNy = Math.max(0, Math.floor((cy - VH) * S));
    const maxNy = Math.min(this.navH - 1, Math.ceil((cy + VH) * S));

    for (let ny = minNy; ny <= maxNy; ny++) {
      const wy = (ny + 0.5) / S;
      const dy = Math.abs(wy - cy);
      if (dy > VH) continue;
      const halfW = dy <= FLAT ? HW : HW * (VH - dy) / (VH - FLAT);
      const rowStartNx = Math.max(minNx, Math.floor((cx - halfW) * S));
      const rowEndNx = Math.min(maxNx, Math.ceil((cx + halfW) * S));
      for (let nx = rowStartNx; nx <= rowEndNx; nx++) {
        this.navGrid![ny * this.navW + nx] = 1;
      }
    }
  }

  private runBFS(snx: number, sny: number, enx: number, eny: number): Int32Array | null {
    this.ensureBuffers();
    const prev = this._bfsPrev!;
    const visited = this._bfsVisited!;
    const queue = this._bfsQueue!;
    prev.fill(-1);
    visited.fill(0);
    const startIdx = sny * this.navW + snx;
    const endIdx = eny * this.navW + enx;
    visited[startIdx] = 1;

    let head = 0, tail = 0;
    queue[tail++] = startIdx;

    const dxy: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];

    while (head < tail) {
      const ci = queue[head++];
      const cx = ci % this.navW, cy = (ci - cx) / this.navW;

      if (ci === endIdx) return prev;

      for (let d = 0; d < 8; d++) {
        const nx = cx + dxy[d][0], ny = cy + dxy[d][1];
        if (nx < 0 || ny < 0 || nx >= this.navW || ny >= this.navH) continue;
        const ni = ny * this.navW + nx;
        if (visited[ni] || this.navGrid![ni]) continue;
        if (d >= 4) {
          if (this.navGrid![cy * this.navW + nx] || this.navGrid![ny * this.navW + cx]) continue;
        }
        visited[ni] = 1;
        prev[ni] = ci;
        queue[tail++] = ni;
      }
    }
    return null;
  }

  private runAStar(snx: number, sny: number, enx: number, eny: number): Int32Array | null {
    this.ensureBuffers();
    const gScore = this._astarGScore!;
    const prev = this._astarPrev!;
    const closed = this._astarClosed!;
    gScore.fill(Infinity);
    prev.fill(-1);
    closed.fill(0);
    const startIdx = sny * this.navW + snx;
    const endIdx = eny * this.navW + enx;
    gScore[startIdx] = 0;

    const maxBuckets = 2048;
    const buckets: number[][] = Array.from({ length: maxBuckets }, () => []);
    const h0 = Math.abs(snx - enx) + Math.abs(sny - eny);
    buckets[Math.min(h0, maxBuckets - 1)].push(startIdx);
    let minBucket = Math.min(h0, maxBuckets - 1);

    const dxy: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    const dcost = [1, 1, 1, 1, 1.41, 1.41, 1.41, 1.41];

    let iterations = 0;
    while (minBucket < maxBuckets && iterations < 80000) {
      while (minBucket < maxBuckets && buckets[minBucket].length === 0) minBucket++;
      if (minBucket >= maxBuckets) break;

      const ci = buckets[minBucket].pop()!;
      if (closed[ci]) continue;
      closed[ci] = 1;
      iterations++;

      const cx = ci % this.navW, cy = (ci - cx) / this.navW;
      if (Math.abs(cx - enx) <= 1 && Math.abs(cy - eny) <= 1) {
        if (ci !== endIdx) prev[endIdx] = ci;
        return prev;
      }

      const g = gScore[ci];
      for (let d = 0; d < 8; d++) {
        const nx = cx + dxy[d][0], ny = cy + dxy[d][1];
        if (nx < 0 || ny < 0 || nx >= this.navW || ny >= this.navH) continue;
        const ni = ny * this.navW + nx;
        if (closed[ni] || this.navGrid![ni]) continue;
        if (d >= 4) {
          if (this.navGrid![cy * this.navW + nx] || this.navGrid![ny * this.navW + cx]) continue;
        }
        const ng = g + dcost[d];
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          prev[ni] = ci;
          const h = Math.abs(nx - enx) + Math.abs(ny - eny);
          const f = Math.min(Math.floor(ng + h), maxBuckets - 1);
          buckets[f].push(ni);
          if (f < minBucket) minBucket = f;
        }
      }
    }
    return null;
  }
}
