/**
 * GameEngine — 렌더링 독립적인 게임 로직 엔진
 * 웹(conquest-scene) + 헤드리스 시뮬레이터 + 서버 모두에서 동일하게 사용 가능
 */

import { Entity, Skill } from '../shared/combat-entities.js';
import { FieldGrid } from '../core/types.js';
import { createFieldGrid, tickField, setTileChangeCallback } from '../core/tick-engine.js';
import { createWood, createWater, createSoil } from '../core/materials.js';
import { hexesInRange, hexDistance, worldToHex, hexNeighborsBounded } from '../core/hex.js';
import { NavGrid } from './pathfinding.js';
import { FogOfWar } from './fog-of-war.js';
import { checkCombo, applyComboEffect, resetComboCooldowns } from './combo-system.js';
import { ULTIMATES, ULT_CHARGE } from './ultimate-defs.js';
import {
  trySpawnItem, checkPickup, applyItem, updateBuffs, updateItems,
  getSpeedMultiplier, getDamageMultiplier, getDefenseMultiplier, resetItemSystem, ITEM_INFO,
  type ItemDrop,
} from './item-system.js';
import {
  updateEvent, tryScheduleEvent, cleanupEvents, createSchedulerState,
  EVENT_INFO, type MapEvent,
} from './map-events.js';

// 타입은 game-engine-types.ts에서 관리, 여기서 재export
export type {
  CapturePoint, Wall, Projectile, AOETelegraph,
  ResourceTerrainType, ResourceTerrain,
  RainEvent, GameState, GameConfig, PathAlgorithm,
  GameCallbacks, AIWorldContext, AIRunner,
  SkillVfxInfo,
} from './game-engine-types.js';
export {
  TERRAIN_INFO, defaultConfig,
  angleDiffAbs, getFireResist, getIceResist,
} from './game-engine-types.js';

import type {
  CapturePoint, Wall, Projectile, AOETelegraph,
  ResourceTerrain,
  GameState, GameConfig,
  GameCallbacks, AIWorldContext, AIRunner,
} from './game-engine-types.js';
import {
  TERRAIN_INFO, defaultConfig,
  angleDiffAbs, getFireResist, getIceResist,
  getTileElement, ELEMENT_WEAKNESS,
  ELEMENT_BUFF_CHARGE, ELEMENT_BUFF_DURATION,
  ELEMENT_DEBUFF_CHARGE, ELEMENT_DEBUFF_DURATION,
  ELEMENT_BUFF_VALUES, ELEMENT_DEBUFF_VALUES,
  FIRE_DOT_BY_ELEMENT,
} from './game-engine-types.js';
import type { ElementType } from './game-engine-types.js';

// ─── 게임 엔진 ───

export class GameEngine {
  state: GameState;
  config: GameConfig;
  callbacks: GameCallbacks;
  private aiRunner: AIRunner | null = null;
  playerControlledId: string | null = null;  // 싱글플레이 하위호환
  playerControlledIds: Set<string> = new Set();  // 멀티플레이: 플레이어 조작 캐릭터 ID 집합
  private baseSpeedMap = new Map<string, number>();
  // 길찾기/벽 체크는 NavGrid 클래스에 위임
  nav = new NavGrid();
  // 팀별 전장의 안개 (AI용 — 렌더링용 FogOfWar와 별개로 각 팀의 시야 추적)
  fogA: FogOfWar | null = null;
  fogB: FogOfWar | null = null;
  // 디버그: 엔티티 위치 추적
  private prevPositions = new Map<string, { x: number; y: number }>();
  stuckCounters = new Map<string, number>();
  private lastStuckLog = 0;
  // 5초간 누적 이동 거리 (도리도리 감지용)
  private moveAccum = new Map<string, number>();
  private lastAccumReset = 0;

  constructor(config: Partial<GameConfig> = {}, callbacks: GameCallbacks = {}) {
    this.config = { ...defaultConfig(), ...config };
    this.callbacks = callbacks;
    this.state = this.createEmptyState();
  }

  private createEmptyState(): GameState {
    return {
      field: createFieldGrid(this.config.fieldW, this.config.fieldH),
      entities: [],
      points: [],
      walls: [],
      scoreA: 0, scoreB: 0,
      time: 0, tickAccum: 0,
      winner: null,
      projectiles: [], telegraphs: [],
      log: [],
      selectedEntityIdx: 0,
      rain: {
        active: false, remaining: 0, intensity: 0,
        nextRainAt: 60 + Math.random() * 30,
        coverLeft: 0, coverRight: this.config.fieldW,
        tickAccum: 0,
      },
      terrains: [],
      items: [],
      nextItemSpawnAt: 20,
      mapEvents: createSchedulerState(),
    };
  }

  // ─── 초기화 ───

  initGame(entities: Entity[], points: CapturePoint[], walls: Wall[], field: FieldGrid, terrains: ResourceTerrain[] = []) {
    this.state.entities = entities;
    this.state.points = points;
    this.state.walls = walls;
    this.state.field = field;
    this.state.terrains = terrains;
    resetComboCooldowns();
    resetItemSystem();
    this.state.items = [];
    this.state.nextItemSpawnAt = 20;
    this.state.mapEvents = createSchedulerState();
    this.state.scoreA = 0;
    this.state.scoreB = 0;
    this.state.time = 0;
    this.state.tickAccum = 0;
    this.state.winner = null;
    this.state.projectiles = [];
    this.state.telegraphs = [];
    this.state.log = [];
    this.state.rain = {
      active: false, remaining: 0, intensity: 0,
      nextRainAt: 60 + Math.random() * 30,
      coverLeft: 0, coverRight: this.config.fieldW,
      tickAccum: 0,
    };
    this.baseSpeedMap.clear();

    // 길찾기/벽 캐시 구축
    this.nav = new NavGrid(this.config.pathAlgorithm, this.config.navScale);
    this.nav.build(this.state.walls, this.config.fieldW, this.config.fieldH);

    // 팀별 전장의 안개 초기화 (AI 시야 추적용)
    this.fogA = new FogOfWar(this.config.fieldW, this.config.fieldH, 6);
    this.fogB = new FogOfWar(this.config.fieldW, this.config.fieldH, 6);

    if (this.callbacks.onTileChange) {
      setTileChangeCallback(this.callbacks.onTileChange);
    }
  }

  setAIRunner(runner: AIRunner) {
    this.aiRunner = runner;
  }

  // ─── 메인 틱 ───

  tick(dt: number) {
    if (this.state.winner) return;

    this.state.time += dt;
    this.state.tickAccum += dt;

    // 팀별 전장의 안개 갱신 (엔티티 visionRange 반영)
    if (this.fogA && this.fogB) {
      const aliveA = this.state.entities.filter(e => e.team === 'A' && !e.dead);
      const aliveB = this.state.entities.filter(e => e.team === 'B' && !e.dead);
      // 각 엔티티의 visionRange 중 최대값을 팀 시야로 사용 (성능 상 한 번만 계산)
      this.fogA.update(aliveA.map(e => ({ x: e.x, y: e.y })));
      this.fogB.update(aliveB.map(e => ({ x: e.x, y: e.y })));
    }

    this.updateRain(dt);

    while (this.state.tickAccum >= this.config.tickInterval) {
      if (!this.config.skipTickField) tickField(this.state.field);
      this.updateBurn();
      this.updateCapture();
      this.updateScore();
      // 궁극기 시간 충전 (틱당)
      for (const e of this.state.entities) {
        if (!e.dead) this.chargeUlt(e, ULT_CHARGE.perTick);
      }
      this.state.tickAccum -= this.config.tickInterval;
    }

    for (const e of this.state.entities) {
      if (e.dead) {
        e.respawnTimer -= dt;
        if (e.respawnTimer <= 0) this.respawn(e);
        continue;
      }
      // 궁극기 캐스팅 처리
      if (e.ultCasting > 0) {
        e.ultCasting -= dt;
        e.vx = 0; e.vy = 0; // 캐스팅 중 정지
        if (e.ultCasting <= 0) {
          this.executeUltimate(e);
        }
        continue; // 캐스팅 중 다른 행동 불가
      }
      // 스킬 선딜 처리
      if (e.skillCasting > 0) {
        // 스턴 맞으면 선딜 취소
        if (e.stunTimer > 0) {
          e.skillCasting = 0;
          e.pendingSkill = null;
        } else {
          e.skillCasting -= dt;
          e.vx = 0; e.vy = 0; // 선딜 중 정지
          if (e.skillCasting <= 0) {
            // 선딜 완료 → 스킬 발동
            if (e.pendingSkill) {
              const { skill, target } = e.pendingSkill;
              e.pendingSkill = null;
              this.executeSkillImmediate(e, skill, target);
              // 후딜 적용
              e.skillRecovery = skill.recoveryTime || 0;
            }
          }
          continue; // 선딜 중 다른 행동 불가
        }
      }
      // 스킬 후딜 처리
      if (e.skillRecovery > 0) {
        if (e.stunTimer > 0) {
          e.skillRecovery = 0; // 스턴이 후딜보다 우선
        } else {
          e.skillRecovery -= dt;
          e.vx = 0; e.vy = 0; // 후딜 중 정지
          if (e.skillRecovery <= 0) e.skillRecovery = 0;
          continue; // 후딜 중 다른 행동 불가
        }
      }
      this.updateEntity(e, dt);
      updateBuffs(e, dt);
    }
    this.updateElementBuffs(dt);

    // 아이템 스폰/획득/수명
    this.updateItems(dt);

    // 맵 이벤트
    this.updateMapEvents(dt);

    this.updateProjectiles(dt);
    this.updateTelegraphs(dt);
    this.checkWin();

    // 누적 이동 거리 추적
    for (const e of this.state.entities) {
      if (e.dead) continue;
      const prev = this.prevPositions.get(e.id);
      if (prev) {
        const dist = Math.sqrt((e.x - prev.x) ** 2 + (e.y - prev.y) ** 2);
        this.moveAccum.set(e.id, (this.moveAccum.get(e.id) || 0) + dist);
      }
      this.prevPositions.set(e.id, { x: e.x, y: e.y });
    }

    // 매 5초마다: 누적 이동 거리가 3 미만이면 도리도리/정지 (거점 위 제외)
    if (this.state.time - this.lastAccumReset > 5) {
      this.lastAccumReset = this.state.time;
      for (const e of this.state.entities) {
        if (e.dead || this.playerControlledIds.has(e.id) || e.id === this.playerControlledId) continue;
        const accum = this.moveAccum.get(e.id) || 0;
        const onPoint = this.state.points.some(pt =>
          Math.sqrt((e.x - pt.x) ** 2 + (e.y - pt.y) ** 2) <= pt.radius
        );
        // 5초간 3유닛 미만 이동 + 거점 위 아님 = 도리도리
        if (accum < 3 && !onPoint) {
          const prevStuck = this.stuckCounters.get(e.id) || 0;
          const newStuck = prevStuck + 300;
          this.stuckCounters.set(e.id, newStuck);
          let nearWalls = '';
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            if (this.nav.isWallAt(Math.floor(e.x) + dx, Math.floor(e.y) + dy)) nearWalls += `(${Math.floor(e.x)+dx},${Math.floor(e.y)+dy})`;
          }
          if (!this.config.silent) console.log(`[DODORI] ${e.name}(${e.team}) pos=(${e.x.toFixed(1)},${e.y.toFixed(1)}) moved=${accum.toFixed(1)}u/5s walls=${nearWalls||'none'} v=(${e.vx.toFixed(1)},${e.vy.toFixed(1)}) stuck=${newStuck}`);

          // ── 교정 조치: committed path 리셋 + 넛지 ──
          this.nav.resetPath(e.id);

          // 2회 연속 도리도리 (10초) → 가장 가까운 빈 공간 방향으로 넛지
          if (newStuck >= 600) {
            this.nav.escapeWall(e); // 벽 안이면 탈출
            // 벽 옆이면 벽에서 멀어지는 방향으로 밀기
            const nudgeDist = 0.8;
            let bestDir: { dx: number; dy: number } | null = null;
            let bestOpen = 0;
            for (const [ndx, ndy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
              const testX = e.x + ndx * nudgeDist;
              const testY = e.y + ndy * nudgeDist;
              if (!this.nav.isWallAtHex(testX, testY) && !this.nav.collidesWithWall(testX, testY, 0.25)) {
                // 해당 방향의 열린 공간 점수 (더 넓은 곳 선호)
                let openScore = 0;
                for (let r = 1; r <= 3; r++) {
                  if (!this.nav.isWallAtHex(e.x + ndx * r * 0.5, e.y + ndy * r * 0.5)) openScore++;
                }
                if (openScore > bestOpen) { bestOpen = openScore; bestDir = { dx: ndx, dy: ndy }; }
              }
            }
            if (bestDir) {
              e.x += bestDir.dx * nudgeDist;
              e.y += bestDir.dy * nudgeDist;
              if (!this.config.silent) console.log(`[DODORI-FIX] ${e.name} nudged to (${e.x.toFixed(1)},${e.y.toFixed(1)})`);
            }
            this.stuckCounters.set(e.id, 0); // 교정 후 리셋
          }
        } else {
          this.stuckCounters.set(e.id, 0);
        }
        this.moveAccum.set(e.id, 0); // 리셋
      }
    }
  }

  // ─── 틱 서브시스템 ───

  private updateBurn() {
    for (const e of this.state.entities) {
      if (e.dead || e.burnTimer <= 0) continue;
      e.burnTimer -= this.config.tickInterval;
      e.hp -= this.config.burnDps;
      if (e.hp <= 0) this.killEntity(e, '화상');
    }
  }

  private updateElementBuffs(dt: number) {
    for (const e of this.state.entities) {
      if (e.dead) continue;
      // 타이머 감소
      if (e.elemBuff > 0) {
        e.elemBuff -= dt;
        if (e.elemBuff <= 0) e.elemBuff = 0;
      }
      if (e.elemDebuff > 0) {
        e.elemDebuff -= dt;
        if (e.elemDebuff <= 0) e.elemDebuff = 0;
      }
      // 이속 효과 적용 (speed는 매 프레임 base에서 리셋되므로 곱셈 OK)
      if (e.elemBuff > 0) {
        const bv = ELEMENT_BUFF_VALUES[e.element];
        e.speed *= bv.speedMult;
        // HP 재생 (Nature)
        if (bv.hpRegen > 0) {
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * bv.hpRegen * dt);
        }
        // CC 저항 (Earth) — stunTimer 감소 가속
        if (bv.ccResist > 0 && e.stunTimer > 0) {
          e.stunTimer -= e.stunTimer * bv.ccResist * dt;
        }
      }
      if (e.elemDebuff > 0) {
        const dv = ELEMENT_DEBUFF_VALUES[e.element];
        e.speed *= dv.speedMult;
      }
    }
  }

  /** 원소 버프/디버프에 의한 공격력 배율 (피해 계산 시 사용) */
  getElementDamageMult(e: Entity): number {
    let mult = 1;
    if (e.elemBuff > 0) mult *= ELEMENT_BUFF_VALUES[e.element].damageMult;
    if (e.elemDebuff > 0) mult *= ELEMENT_DEBUFF_VALUES[e.element].damageMult;
    return mult;
  }

  /** 원소 버프에 의한 방어 배율 (피해 적용 시 사용) */
  getElementDefenseMult(e: Entity): number {
    if (e.elemBuff > 0) return ELEMENT_BUFF_VALUES[e.element].defenseMult;
    if (e.elemDebuff > 0) return ELEMENT_DEBUFF_VALUES[e.element].extraDamageMult;
    return 1;
  }

  private updateCapture() {
    for (const pt of this.state.points) {
      let aCount = 0, bCount = 0;
      for (const e of this.state.entities) {
        if (e.dead || e.invincibleTimer > 0) continue;
        if (Math.sqrt((e.x - pt.x) ** 2 + (e.y - pt.y) ** 2) <= pt.radius) {
          if (e.team === 'A') aCount++; else bCount++;
        }
      }

      const speed = 10;
      if (aCount > 0 && bCount === 0) {
        pt.capturingTeam = 'A';
        if (pt.owner === 'A') { pt.progress = Math.min(100, pt.progress + speed); }
        else if (pt.owner === 'B') { pt.progress -= speed * 1.5; if (pt.progress <= 0) { pt.owner = 'neutral'; pt.progress = 0; this.log('A팀이 거점 중립화!'); } }
        else { pt.progress += speed * aCount; if (pt.progress >= 100) { pt.owner = 'A'; pt.progress = 100; this.log('A팀 거점 점령!'); this.creditCapture('A', pt); this.callbacks.onCapture?.(pt, 'A'); this.chargeTeamUlt('A', ULT_CHARGE.capture); } }
      } else if (bCount > 0 && aCount === 0) {
        pt.capturingTeam = 'B';
        if (pt.owner === 'B') { pt.progress = Math.min(100, pt.progress + speed); }
        else if (pt.owner === 'A') { pt.progress -= speed * 1.5; if (pt.progress <= 0) { pt.owner = 'neutral'; pt.progress = 0; this.log('B팀이 거점 중립화!'); } }
        else { pt.progress += speed * bCount; if (pt.progress >= 100) { pt.owner = 'B'; pt.progress = 100; this.log('B팀 거점 점령!'); this.creditCapture('B', pt); this.callbacks.onCapture?.(pt, 'B'); this.chargeTeamUlt('B', ULT_CHARGE.capture); } }
      } else if (aCount > 0 && bCount > 0) {
        // 교전 중: 자기팀 거점을 방어하는 유닛에게 defend 크레딧
        if (pt.owner === 'A') { this.creditDefend('A', pt); }
        else if (pt.owner === 'B') { this.creditDefend('B', pt); }
        pt.capturingTeam = null;
      } else {
        pt.capturingTeam = null;
        if (pt.owner !== 'neutral' && pt.progress > 50) { pt.progress = Math.max(50, pt.progress - 1); }
      }
    }
  }

  private updateScore() {
    const aOwned = this.state.points.filter(p => p.owner === 'A').length;
    const bOwned = this.state.points.filter(p => p.owner === 'B').length;
    if (aOwned >= 1) this.state.scoreA += aOwned * 0.2;
    if (bOwned >= 1) this.state.scoreB += bOwned * 0.2;
  }

  // ─── 아이템 ───

  private updateItems(dt: number) {
    // 스폰
    const result = trySpawnItem(
      this.state.items, this.state.time,
      this.config.fieldW, this.config.fieldH,
      (x, y) => this.nav.isWallAtHex(x, y),
      this.state.nextItemSpawnAt,
    );
    if (result.spawned) {
      this.state.items.push(result.spawned);
      const info = ITEM_INFO[result.spawned.type];
      this.log(`${info.icon} ${info.name} 등장! (${result.spawned.x.toFixed(0)},${result.spawned.y.toFixed(0)})`);
      this.callbacks.onItemSpawn?.(result.spawned);
    }
    this.state.nextItemSpawnAt = result.nextSpawnAt;

    // 획득
    const pickups = checkPickup(this.state.items, this.state.entities);
    for (const { entity, item } of pickups) {
      applyItem(entity, item);
      const info = ITEM_INFO[item.type];
      this.log(`${info.icon} ${entity.name}(${entity.team}) ${info.name} 획득!`);
      this.callbacks.onItemPickup?.(entity, item);
    }

    // 수명
    this.state.items = updateItems(this.state.items, dt);
  }

  // ─── 맵 이벤트 ───

  private updateMapEvents(dt: number) {
    const sched = this.state.mapEvents;

    // 새 이벤트 스케줄
    const newEvent = tryScheduleEvent(sched, this.state.time, this.config.fieldW, this.config.fieldH);
    if (newEvent) {
      const info = EVENT_INFO[newEvent.type];
      this.log(`⚠️ ${info.icon} ${info.name} 경고! ${info.warningDuration}초 후 발동!`);
      this.callbacks.onMapEventStart?.(newEvent);
    }

    // 기존 이벤트 업데이트
    for (const event of sched.events) {
      if (event.remaining <= 0) continue;
      const prevPhase = event.phase;
      updateEvent(event, dt);

      // warning → active 전환 시
      if (prevPhase === 'warning' && event.phase === 'active') {
        const info = EVENT_INFO[event.type];
        this.log(`${info.icon} ${info.name} 발동!`);
        this.callbacks.onMapEventActive?.(event);
        this.applyMapEventStart(event);
      }

      // active 중 지속 효과
      if (event.phase === 'active') {
        this.applyMapEventTick(event, dt);
      }

      // ending
      if (event.remaining <= 0) {
        const info = EVENT_INFO[event.type];
        this.log(`${info.icon} ${info.name} 종료`);
        this.callbacks.onMapEventEnd?.(event);
      }
    }

    cleanupEvents(sched);
  }

  /** 이벤트 시작 시 1회 효과 */
  private applyMapEventStart(event: MapEvent) {
    const { fieldW, fieldH } = this.config;
    switch (event.type) {
      case 'volcanic':
        // 용암: 중심에 발화
        this.applyFieldEffect('ignite', event.x, event.y, event.radius * 2);
        break;
      case 'flood':
        // 강 범람: 강(y=24~25)에서 위쪽으로 물 확산 시작
        for (let y = fieldH - 4; y < fieldH; y++) {
          for (let x = 0; x < fieldW; x++) {
            const cell = this.state.field[y]?.[x];
            if (cell && !cell.material) cell.material = createWater(3 + Math.random() * 2);
            if (cell?.material?.type === 'water') cell.material.mass = Math.min(8, cell.material.mass + 2);
          }
        }
        break;
      case 'earthquake':
        // 지진: 전체 엔티티 스턴 + 벽 일부 변화
        for (const e of this.state.entities) {
          if (!e.dead) e.stunTimer = Math.max(e.stunTimer, 0.8);
        }
        break;
    }
  }

  /** 이벤트 지속 효과 (매 프레임) */
  private applyMapEventTick(event: MapEvent, dt: number) {
    switch (event.type) {
      case 'volcanic': {
        // 용암 지대: 범위 내 엔티티 화상
        for (const e of this.state.entities) {
          if (e.dead) continue;
          const d = Math.sqrt((e.x - event.x) ** 2 + (e.y - event.y) ** 2);
          if (d <= event.radius) {
            e.hp -= 12 * dt;
            e.burnTimer = Math.max(e.burnTimer, 0.5);
            if (e.hp <= 0) this.killEntity(e, '용암');
          }
        }
        break;
      }
      case 'flood': {
        // 강 범람: 시간에 따라 물이 위쪽으로 확산
        const info = EVENT_INFO[event.type];
        const elapsed = event.duration - event.remaining - info.warningDuration;
        const maxRise = 8; // 최대 8줄 올라감
        const riseRows = Math.min(maxRise, Math.floor(elapsed * 0.8)); // 초당 0.8줄
        const floodLine = this.config.fieldH - 3 - riseRows;

        // 범람 영역에 물 생성 (매 0.5초)
        if (Math.random() < dt * 2) {
          for (let y = floodLine; y < this.config.fieldH; y++) {
            for (let x = 0; x < this.config.fieldW; x++) {
              const cell = this.state.field[y]?.[x];
              if (!cell) continue;
              if (!cell.material && Math.random() < 0.3) {
                cell.material = createWater(2 + Math.random() * 2);
              }
              if (cell.material?.type === 'water') {
                cell.material.mass = Math.min(8, cell.material.mass + 0.5);
              }
            }
          }
        }

        // 범람 영역 내 엔티티 감속 + 약한 대미지
        for (const e of this.state.entities) {
          if (e.dead || e.y < floodLine) continue;
          e.speed *= 0.7;
          e.hp -= 3 * dt;
          if (e.hp <= 0) this.killEntity(e, '강 범람');
        }
        break;
      }
      case 'blizzard': {
        // 눈보라: 전체 맵 온도 하락 + 감속
        // 0.5초마다 필드 냉각
        if (Math.random() < dt * 2) {
          const { fieldW, fieldH } = this.config;
          for (let y = 0; y < fieldH; y += 2) {
            for (let x = 0; x < fieldW; x += 2) {
              const cell = this.state.field[y]?.[x];
              if (cell?.material) {
                cell.material.temperature = Math.max(-10, cell.material.temperature - 3);
                if (cell.material.type === 'water' && cell.material.temperature <= 0) {
                  cell.material.thermalState = 'frozen';
                }
              }
            }
          }
        }
        // 엔티티 감속
        for (const e of this.state.entities) {
          if (!e.dead) e.speed *= 0.85;
        }
        break;
      }
      case 'eclipse': {
        // 일식: 주로 렌더링에서 처리 (시야 감소). 엔진에서는 별도 효과 없음.
        break;
      }
      // earthquake: 시작 시 1회 스턴만, 지속 효과 없음
    }
  }

  // ─── 비 이벤트 ───

  private updateRain(dt: number) {
    const rain = this.state.rain;

    if (!rain.active) {
      // 비 대기 중
      if (this.state.time >= rain.nextRainAt) {
        // 비 시작
        rain.active = true;
        rain.intensity = 0.3 + Math.random() * 0.7; // 0.3~1.0
        rain.remaining = 8 + Math.random() * 7;      // 8~15초

        // 비 범위: 70% 확률 전체, 30% 확률 반쪽
        if (Math.random() < 0.7) {
          rain.coverLeft = 0;
          rain.coverRight = this.config.fieldW;
        } else {
          const half = this.config.fieldW / 2;
          if (Math.random() < 0.5) {
            rain.coverLeft = 0;
            rain.coverRight = half + Math.random() * 10;
          } else {
            rain.coverLeft = half - Math.random() * 10;
            rain.coverRight = this.config.fieldW;
          }
        }

        rain.tickAccum = 0;
        this.log(`🌧️ 비가 내리기 시작합니다! (강도: ${(rain.intensity * 100).toFixed(0)}%)`);
        this.callbacks.onRainStart?.(rain.intensity, rain.coverLeft, rain.coverRight);
      }
      return;
    }

    // 비 진행 중
    rain.remaining -= dt;
    rain.tickAccum += dt;

    // 0.5초마다 비 효과 적용 (성능)
    if (rain.tickAccum >= 0.5) {
      rain.tickAccum -= 0.5;
      this.applyRainTick();
    }

    // 비 종료
    if (rain.remaining <= 0) {
      rain.active = false;
      rain.nextRainAt = this.state.time + 50 + Math.random() * 40; // 다음 비: 50~90초 후
      this.log('🌤️ 비가 그쳤습니다.');
      this.callbacks.onRainStop?.();
    }
  }

  private applyRainTick() {
    const rain = this.state.rain;
    const { fieldW, fieldH } = this.config;
    const field = this.state.field;

    for (let y = 0; y < fieldH; y++) {
      for (let x = Math.floor(rain.coverLeft); x < Math.ceil(rain.coverRight); x++) {
        if (x < 0 || x >= fieldW) continue;

        // 빗방울 확률: intensity에 비례 (강도 0.5 = 5% 확률/칸/틱)
        if (Math.random() > rain.intensity * 0.1) continue;

        const cell = field[y][x];

        if (!cell.material) {
          // 빈 타일: 낮은 확률로 물 웅덩이 생성
          if (Math.random() < 0.15 * rain.intensity) {
            cell.material = createWater(1 + Math.random() * 2);
          }
          continue;
        }

        switch (cell.material.type) {
          case 'water':
            // 기존 물: mass 보충
            cell.material.mass = Math.min(8, cell.material.mass + 0.3 * rain.intensity);
            // 얼음이면 녹이기
            if (cell.material.thermalState === 'frozen') {
              cell.material.temperature = Math.min(cell.material.temperature + 5, 20);
            }
            break;

          case 'wood':
            // 불 약화: 온도 냉각
            if (cell.material.thermalState === 'burning') {
              cell.material.temperature -= 20 * rain.intensity;
              cell.material.mass += 0.05; // 약간의 습기로 연소 지연
            } else if (cell.material.thermalState === 'smoldering') {
              cell.material.temperature -= 30 * rain.intensity; // 잔불은 더 빨리 꺼짐
            }
            break;

          case 'soil':
            // 흙: damp 상태로 전환 (성장 촉진)
            if (cell.material.thermalState === 'normal') {
              cell.material.thermalState = 'damp';
            }
            // 온도 냉각
            cell.material.temperature = Math.max(15, cell.material.temperature - 5 * rain.intensity);
            break;
        }
      }
    }
  }

  killEntity(e: Entity, cause: string) {
    // 샌드박스 더미는 죽지 않음 (무적)
    if ((e as any).sandboxDummy) {
      e.hp = e.maxHp;
      return;
    }
    e.dead = true;
    e.hp = 0;
    e.deaths++;
    e.respawnTimer = this.config.respawnTime;
    // 스킬 캐스팅/후딜 초기화
    e.skillCasting = 0;
    e.skillRecovery = 0;
    e.pendingSkill = null;

    const killer = this.state.entities.find(k => k.name === cause || cause.startsWith(k.name + ' ') || k.skills.some(s => s.name === cause));
    if (killer && killer.team !== e.team) {
      killer.kills++;
      this.chargeUlt(killer, ULT_CHARGE.kill);
    }
    // 어시스트: 같은 팀이 5초 내 대미지 준 적이 죽으면 충전
    for (const ally of this.state.entities) {
      if (ally === killer || ally.team === e.team || ally.dead) continue;
      if (ally.team === killer?.team) {
        ally.assists++;
        this.chargeUlt(ally, ULT_CHARGE.assist);
      }
    }
    // 사망 패널티
    this.chargeUlt(e, -ULT_CHARGE.deathPenalty);

    // 사망 시 원소 효과
    this.applyDeathEffect(e);

    this.log(`${e.name}(${e.team}) ${cause}으로 사망! ${this.config.respawnTime}초 후 부활`);
    this.callbacks.onKill?.(e, cause, killer);
  }

  private applyDeathEffect(e: Entity) {
    const dh = worldToHex(e.x, e.y);
    const cx = dh.col, cy = dh.row;
    const r = 2; // 효과 반경

    switch (e.name) {
      case '테라': // 흙족: 주변에 흙 생성
        this.applyFieldEffect('mud', cx, cy, 4);
        break;

      case '실반': // 나무족: 주변에 나무 성장
        this.applyFieldEffect('grow', cx, cy, 4);
        break;

      case '그로브': // 물+나무: 치유의 물결 (물+나무)
        this.applyFieldEffect('water', cx, cy, 3);
        this.applyFieldEffect('grow', cx, cy, 5);
        // 주변 아군 소량 힐
        for (const a of this.state.entities) {
          if (a.team !== e.team || a.dead || a === e) continue;
          if (Math.sqrt((a.x - e.x) ** 2 + (a.y - e.y) ** 2) <= 4) {
            const heal = 15;
            a.hp = Math.min(a.maxHp, a.hp + heal);
            this.callbacks.onHeal?.(a, heal, a.x, a.y);
          }
        }
        break;

      case '페룸': // 금속/불: 폭발 (점화 + 주변 적 데미지)
        this.applyFieldEffect('ignite', cx, cy, 4);
        for (const t of this.state.entities) {
          if (t.team === e.team || t.dead) continue;
          if (Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2) <= r + 1) {
            t.hp -= 10;
            t.burnTimer = Math.max(t.burnTimer, 2);
            this.callbacks.onDamage?.(t, 10, t.x, t.y);
            if (t.hp <= 0) this.killEntity(t, '페룸 폭발');
          }
        }
        break;

      case '루미나': // 빛: 섬광 (주변 적 경직)
        for (const t of this.state.entities) {
          if (t.team === e.team || t.dead) continue;
          if (Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2) <= r + 1) {
            t.stunTimer = Math.max(t.stunTimer, 1.2);
          }
        }
        break;

      case '에리스': // 바람: 돌풍 (주변 적 밀어내기)
        for (const t of this.state.entities) {
          if (t.team === e.team || t.dead) continue;
          const dx = t.x - e.x, dy = t.y - e.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d <= r + 2 && d > 0.1) {
            t.vx += (dx / d) * 8;
            t.vy += (dy / d) * 8;
          }
        }
        break;

      case '바위': // 돌: 지진 (주변 적 스턴 + 흙 생성)
        this.applyFieldEffect('mud', cx, cy, 5);
        for (const t of this.state.entities) {
          if (t.team === e.team || t.dead) continue;
          if (Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2) <= r + 1) {
            t.stunTimer = Math.max(t.stunTimer, 1.0);
            t.hp -= 8;
            this.callbacks.onDamage?.(t, 8, t.x, t.y);
          }
        }
        break;

      case '타이드': // 물: 물 폭발 (주변에 물 + 적 감속)
        this.applyFieldEffect('water', cx, cy, 5);
        this.applyFieldEffect('freeze', cx, cy, 3);
        break;
    }
  }

  private respawn(e: Entity) {
    e.dead = false;
    e.hp = e.maxHp;
    e.x = e.spawnX; e.y = e.spawnY;
    e.stunTimer = 0; e.burnTimer = 0;
    e.dashing = false; e.dashTarget = null;
    e.invincibleTimer = this.config.invincibleTime;
    e.ultCasting = 0;
    e.ultCharge = 0;
    e.ultReady = false;
    e.buffs = [];
    e.elemBuff = 0; e.elemDebuff = 0;
    e.elemChargeTimer = 0; e.elemChargeType = null;
    for (const s of e.skills) s.remaining = Math.min(s.remaining, 2);
    this.log(`${e.name}(${e.team}) 부활!`);
    this.callbacks.onRespawn?.(e);
  }

  // ─── 궁극기 ───

  chargeUlt(e: Entity, amount: number) {
    if (e.dead && amount > 0) return;
    e.ultCharge = Math.max(0, Math.min(ULT_CHARGE.max, e.ultCharge + amount));
    const wasReady = e.ultReady;
    e.ultReady = e.ultCharge >= ULT_CHARGE.max;
    if (e.ultReady && !wasReady) {
      this.callbacks.onUltReady?.(e);
    }
  }

  chargeTeamUlt(team: 'A' | 'B', amount: number) {
    for (const e of this.state.entities) {
      if (e.team === team && !e.dead) this.chargeUlt(e, amount);
    }
  }

  /** 거점 점령 시 거점 범위 안의 해당 팀 유닛에 captures++ */
  private creditCapture(team: 'A' | 'B', pt: CapturePoint) {
    for (const e of this.state.entities) {
      if (e.dead || e.team !== team) continue;
      if (Math.sqrt((e.x - pt.x) ** 2 + (e.y - pt.y) ** 2) <= pt.radius) {
        e.captures++;
      }
    }
  }

  /** 거점 방어: 자기팀 거점에서 교전 중인 아군에 defends++ (틱당 호출되므로 쿨다운 적용) */
  private _defendCreditTimer = 0;
  private creditDefend(team: 'A' | 'B', pt: CapturePoint) {
    // 5초에 1번만 크레딧 (매 틱 호출 방지)
    this._defendCreditTimer += this.config.tickInterval;
    if (this._defendCreditTimer < 5) return;
    this._defendCreditTimer = 0;
    for (const e of this.state.entities) {
      if (e.dead || e.team !== team) continue;
      if (Math.sqrt((e.x - pt.x) ** 2 + (e.y - pt.y) ** 2) <= pt.radius) {
        e.defends++;
        this.chargeUlt(e, ULT_CHARGE.defend);
      }
    }
  }

  /** 궁극기 사용 시작 (캐스팅) */
  useUltimate(e: Entity) {
    if (!e.ultReady || e.dead || e.stunTimer > 0 || e.ultCasting > 0) return;
    const ult = ULTIMATES[e.name];
    if (!ult) return;
    e.ultCasting = ult.castTime;
    e.ultCharge = 0;
    e.ultReady = false;
    this.log(`🔥 ${e.name}(${e.team}) 궁극기 [${ult.name}] 발동!`);
    this.callbacks.onUltimate?.(e, ult.name, ult.icon, ult.color, ult.screenColor);
  }

  /** 궁극기 효과 실행 (캐스팅 완료 시) */
  private executeUltimate(e: Entity) {
    const ult = ULTIMATES[e.name];
    if (!ult) return;
    const result = ult.execute(e, this.state.entities);

    // 대미지 콜백 + 사망 처리
    for (const d of result.damaged) {
      this.callbacks.onDamage?.(d.entity, d.amount, d.entity.x, d.entity.y);
      if (d.entity.hp <= 0) this.killEntity(d.entity, ult.name);
    }
    // 힐 콜백
    for (const h of result.healed) {
      this.callbacks.onHeal?.(h.entity, h.amount, h.entity.x, h.entity.y);
    }

    // 궁극기 필드이펙트 — 타일에 원소 효과 적용
    const uh = worldToHex(e.x, e.y);
    switch (e.name) {
      case '타이드':   // 대해일: 광역 물 + 빙결
        this.applyFieldEffect('water', uh.col, uh.row, 12, e);
        this.applyFieldEffect('freeze', uh.col, uh.row, 6, e);
        break;
      case '페룸':     // 용광로: 광역 발화
        this.applyFieldEffect('ignite', uh.col, uh.row, 7, e);
        break;
      case '그로브':   // 생명의 나무: 광역 나무 성장
        this.applyFieldEffect('grow', uh.col, uh.row, 8, e);
        this.applyFieldEffect('water', uh.col, uh.row, 4, e);
        break;
      case '바위':     // 철벽 요새: 진흙 지대
        this.applyFieldEffect('mud', uh.col, uh.row, 6, e);
        break;
      case '에리스': { // 태풍의 눈: 산소 박탈 → 불 꺼짐
        const r = Math.ceil(10 / 2);
        const hexes = hexesInRange(uh.col, uh.row, r, this.config.fieldW, this.config.fieldH);
        for (const h of hexes) {
          const cell = this.state.field[h.row]?.[h.col];
          if (!cell?.material) continue;
          // 불타는 나무 → 소멸 (산소 부족)
          if (cell.material.type === 'wood' &&
              (cell.material.thermalState === 'burning' || cell.material.thermalState === 'smoldering')) {
            cell.material.thermalState = 'charcoal';
            cell.material.temperature = 20;
          }
        }
        break;
      }
      case '테라':     // 대지의 분노: 전방에 흙
        this.applyFieldEffect('mud', uh.col, uh.row, 4, e);
        break;
    }

    // 인게임 VFX 콜백 (컷신 끝나고 실제 효과 발동 시)
    this.callbacks.onUltExecute?.(e, ult.name, ult.color);
  }

  private checkWin() {
    if (this.state.winner) return;
    if (this.state.scoreA >= this.config.winScore) {
      this.state.winner = 'A팀 승리!';
      this.log('A팀 승리!');
      this.callbacks.onWin?.('A', this.state.scoreA, this.state.scoreB);
    }
    if (this.state.scoreB >= this.config.winScore) {
      this.state.winner = 'B팀 승리!';
      this.log('B팀 승리!');
      this.callbacks.onWin?.('B', this.state.scoreA, this.state.scoreB);
    }
  }

  // ─── 엔티티 업데이트 ───

  private getBaseSpeed(e: Entity): number {
    if (!this.baseSpeedMap.has(e.id)) this.baseSpeedMap.set(e.id, e.speed);
    return this.baseSpeedMap.get(e.id)!;
  }

  private updateEntity(e: Entity, dt: number) {
    // 샌드박스 더미: HP 즉시 회복 + 스턴/화상 무시 + 이동 안 함
    if ((e as any).sandboxDummy) {
      e.hp = e.maxHp;
      e.stunTimer = 0;
      e.burnTimer = 0;
      e.vx = 0; e.vy = 0;
      return;
    }
    e.speed = this.getBaseSpeed(e) * getSpeedMultiplier(e);
    if (e.invincibleTimer > 0) e.invincibleTimer -= dt;
    if (e.stunTimer > 0) { e.stunTimer -= dt; e.vx = 0; e.vy = 0; return; }
    e.attackCooldown = Math.max(0, e.attackCooldown - dt);
    for (const s of e.skills) s.remaining = Math.max(0, s.remaining - dt);

    // 대쉬 처리
    if (e.dashing && e.dashTarget) {
      const dx = e.dashTarget.x - e.x, dy = e.dashTarget.y - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      e.facingAngle = Math.atan2(dy, dx);

      if (dist < 0.8) {
        e.dashing = false;
        const hitTarget = this.state.entities.find(t => t.team !== e.team && !t.dead &&
          Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2) < 2);
        if (hitTarget) {
          hitTarget.hp -= e.dashDamage;
          if (e.dashStun > 0) hitTarget.stunTimer = Math.max(hitTarget.stunTimer, e.dashStun);
          this.callbacks.onDashHit?.(e, hitTarget, e.dashDamage, e.facingAngle);
          if (hitTarget.hp <= 0) this.killEntity(hitTarget, e.dashSkillName);
        }
        e.dashTarget = null; e.vx = 0; e.vy = 0;
      } else {
        e.vx = (dx / dist) * e.dashSpeed;
        e.vy = (dy / dist) * e.dashSpeed;
        const nextX = e.x + e.vx * dt, nextY = e.y + e.vy * dt;
        if (this.nav.isWallAtHex(nextX, nextY)) {
          e.dashing = false; e.dashTarget = null; e.vx = 0; e.vy = 0;
          // 벽에서 밀어냄
          if (this.nav.isWallAtHex(e.x, e.y)) {
            const wx = Math.floor(e.x) + 0.5, wy = Math.floor(e.y) + 0.5;
            const pdx = e.x - wx, pdy = e.y - wy;
            if (Math.abs(pdx) > Math.abs(pdy)) { e.x = pdx > 0 ? Math.floor(e.x) + 1.01 : Math.floor(e.x) - 0.01; }
            else { e.y = pdy > 0 ? Math.floor(e.y) + 1.01 : Math.floor(e.y) - 0.01; }
          }
        }
      }
    }

    // AI (플레이어 조작 캐릭터 및 샌드박스 더미는 건너뜀)
    if (!e.dashing && this.aiRunner && e.id !== this.playerControlledId && !this.playerControlledIds.has(e.id) && !(e as any).sandboxDummy) {
      this.aiRunner(e, this.getAIContext());
    }

    // 이동
    if (!e.dashing && (Math.abs(e.vx) > 0.1 || Math.abs(e.vy) > 0.1)) {
      e.facingAngle = Math.atan2(e.vy, e.vx);
    }

    // ─── 벽 충돌: nav 그리드 기반 (BFS와 동일 좌표계) ───
    const newX = e.x + e.vx * dt;
    const newY = e.y + e.vy * dt;

    // nav 그리드에서 이동 가능 여부 체크
    const canMoveXY = !this.nav.isWallAtHex(newX, newY);
    if (canMoveXY) {
      e.x = newX;
      e.y = newY;
    } else {
      // 축별 분리 (슬라이딩)
      const canMoveX = !this.nav.isWallAtHex(newX, e.y);
      const canMoveY = !this.nav.isWallAtHex(e.x, newY);
      if (canMoveX) e.x = newX;
      if (canMoveY) e.y = newY;
    }

    e.x = Math.max(0.5, Math.min(this.config.fieldW - 0.5, e.x));
    e.y = Math.max(0.5, Math.min(this.config.fieldH - 0.5, e.y));

    // 벽 안에 끼인 경우 탈출
    this.nav.escapeWall(e);

    // 장판 효과 (엔티티가 밟고 있는 hex 타일)
    const fhex = worldToHex(e.x, e.y);
    const fx = fhex.col, fy = fhex.row;
    if (fy >= 0 && fy < this.config.fieldH && fx >= 0 && fx < this.config.fieldW) {
      const mat = this.state.field[fy][fx].material;
      if (mat) {
        const iceResist = getIceResist(e);
        switch (mat.thermalState) {
          case 'burning': case 'molten': {
            // 불 DOT: 속성별 차등 (fire 캐릭 면역)
            const fireDot = FIRE_DOT_BY_ELEMENT[e.element];
            if (fireDot > 0) {
              e.burnTimer = Math.max(e.burnTimer, 2.5);
              e.hp -= fireDot * dt;
              if (e.hp <= 0) this.killEntity(e, '화상');
            }
            break;
          }
          case 'frozen':
            if (iceResist < 0.8) {
              e.speed = Math.max(0.5, e.speed * (0.3 + iceResist * 0.5));
              if (Math.random() < 0.05) e.stunTimer = Math.max(e.stunTimer, 0.4);
            }
            break;
          case 'damp':
            e.speed = Math.max(0.8, e.speed * 0.5);
            break;
          case 'steam':
            e.burnTimer = Math.max(e.burnTimer, 1.0);
            e.speed = Math.max(1, e.speed * 0.8);
            break;
        }

        // ── 원소 속성 버프/디버프 충전 ──
        const tileElem = getTileElement(mat.type, mat.thermalState);
        if (tileElem) {
          const weakness = ELEMENT_WEAKNESS[e.element]; // 나에게 약한 타일 속성
          if (tileElem === e.element) {
            // 동일 속성 타일 → 디버프 즉시 해제 + 버프 충전
            if (e.elemDebuff > 0) e.elemDebuff = 0;
            if (e.elemChargeType !== 'buff') {
              e.elemChargeTimer = 0;
              e.elemChargeType = 'buff';
            }
            e.elemChargeTimer += dt;
            if (e.elemChargeTimer >= ELEMENT_BUFF_CHARGE && e.elemBuff <= 0) {
              e.elemBuff = ELEMENT_BUFF_DURATION;
              e.elemChargeTimer = 0;
              e.elemChargeType = null;
            }
          } else if (tileElem === weakness) {
            // 상극 타일 → 버프 즉시 해제 + 디버프 충전
            if (e.elemBuff > 0) e.elemBuff = 0;
            if (e.elemChargeType !== 'debuff') {
              e.elemChargeTimer = 0;
              e.elemChargeType = 'debuff';
            }
            e.elemChargeTimer += dt;
            if (e.elemChargeTimer >= ELEMENT_DEBUFF_CHARGE && e.elemDebuff <= 0) {
              e.elemDebuff = ELEMENT_DEBUFF_DURATION;
              e.elemChargeTimer = 0;
              e.elemChargeType = null;
            }
          } else {
            // 중립 타일 → 충전 리셋
            e.elemChargeTimer = 0;
            e.elemChargeType = null;
          }
        } else {
          // 빈 타일 → 충전 리셋
          e.elemChargeTimer = 0;
          e.elemChargeType = null;
        }
      } else {
        // material 없음 → 충전 리셋
        e.elemChargeTimer = 0;
        e.elemChargeType = null;
      }
    }

    // 열기 효과 (Burning 근처) — hex 2칸 범위
    const heatHexes = hexesInRange(fx, fy, 2, this.config.fieldW, this.config.fieldH);
    for (const hh of heatHexes) {
      const nearMat = this.state.field[hh.row][hh.col].material;
      if (nearMat && nearMat.thermalState === 'burning') {
        e.speed = Math.max(1, e.speed * 0.8);
        break; // 1번만 적용
      }
    }

    // 자원 지형 패시브 효과
    for (const t of this.state.terrains) {
      const dist = Math.sqrt((e.x - t.x) ** 2 + (e.y - t.y) ** 2);
      if (dist > t.radius) continue;

      switch (t.type) {
        case 'vent':
          // 열수구: 위에 서면 화상 위험
          if (dist < 1.5) e.burnTimer = Math.max(e.burnTimer, 0.5);
          break;
        case 'moss':
          // 이끼밭: HP 회복 (틱당 1HP, dt 보정)
          e.hp = Math.min(e.maxHp, e.hp + 1 * dt * 4);
          if (e.healingDone !== undefined) e.healingDone += 1 * dt * 4;
          break;
        case 'wind':
          // 바람골: 이속 +15%
          e.speed *= 1.15;
          break;
        case 'crystal':
          // 수정: 가시성 (향후), 현재 무효과
          break;
      }
    }
  }

  // ─── 투사체 ───

  private updateProjectiles(dt: number) {
    for (const p of this.state.projectiles) {
      if (p.tracking === 'loose' && !p.target.dead) {
        const dx = p.target.x - p.x, dy = p.target.y - p.y;
        const targetAngle = Math.atan2(dy, dx);
        const curAngle = Math.atan2(p.vy, p.vx);
        let diff = targetAngle - curAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = Math.sign(diff) * Math.min(Math.abs(diff), p.turnRate * dt);
        const newAngle = curAngle + turn;
        p.vx = Math.cos(newAngle) * p.speed;
        p.vy = Math.sin(newAngle) * p.speed;
      }
      const prevPx = p.x, prevPy = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.lifetime -= dt;

      // 팀 시야 밖으로 나간 투사체는 소멸 (동료 시야 안이면 유지)
      if (!this.isTeamVisible(p.owner.team, p.x, p.y)) { p.lifetime = 0; continue; }

      // 벽 충돌: Math.floor 기반 경로 샘플링 (엔티티 충돌과 동일 좌표계)
      const moveDist = Math.sqrt((p.x - prevPx) ** 2 + (p.y - prevPy) ** 2);
      const checkSteps = Math.max(2, Math.ceil(moveDist * 4));
      let hitWall = false;
      for (let s = 0; s <= checkSteps; s++) {
        const t = s / checkSteps;
        const cx = prevPx + (p.x - prevPx) * t;
        const cy = prevPy + (p.y - prevPy) * t;
        if (this.nav.isWallAtHex(cx, cy)) { hitWall = true; break; }
      }
      if (hitWall) { p.lifetime = 0; continue; }
      if (p.x < 0 || p.x >= this.config.fieldW || p.y < 0 || p.y >= this.config.fieldH) { p.lifetime = 0; continue; }

      for (const e of this.state.entities) {
        if (e.team === p.owner.team || e.dead || e.invincibleTimer > 0) continue;
        const dist = Math.sqrt((e.x - p.x) ** 2 + (e.y - p.y) ** 2);
        if (dist < p.hitRadius + e.size * 0.3) {
          if (p.aoe > 0) {
            for (const t of this.state.entities) {
              if (t.team === p.owner.team || t.dead) continue;
              if (Math.sqrt((t.x - p.x) ** 2 + (t.y - p.y) ** 2) <= p.aoe) {
                t.hp -= p.damage;
                p.owner.damageDealt += p.damage;
                t.damageTaken += p.damage;
                if (p.stunDuration > 0) t.stunTimer = Math.max(t.stunTimer, p.stunDuration);
                this.callbacks.onDamage?.(t, p.damage, t.x, t.y);
                if (t.hp <= 0) this.killEntity(t, p.skillName);
              }
            }
          } else {
            const projDmg = Math.round(p.damage * getDefenseMultiplier(e));
            e.hp -= projDmg;
            p.owner.damageDealt += projDmg;
            e.damageTaken += projDmg;
            if (p.stunDuration > 0) e.stunTimer = Math.max(e.stunTimer, p.stunDuration);
            this.callbacks.onDamage?.(e, projDmg, e.x, e.y);
            if (e.hp <= 0) this.killEntity(e, p.skillName);
          }
          { const ph = worldToHex(p.x, p.y); if (p.fieldEffect) this.applyFieldEffect(p.fieldEffect, ph.col, ph.row, p.aoe || 2, p.owner); }
          this.callbacks.onProjectileHit?.(p.x, p.y, p.aoe, p.color, p.skillVfx);
          p.lifetime = 0;
          break;
        }
      }
    }
    this.state.projectiles = this.state.projectiles.filter(p => p.lifetime > 0);
  }

  // ─── 텔레그래프 ───

  private updateTelegraphs(dt: number) {
    for (const t of this.state.telegraphs) {
      t.delay -= dt;
      if (t.delay <= 0) {
        if (t.isHeal) {
          for (const e of this.state.entities) {
            if (e.team !== t.owner.team || e.dead) continue;
            if (Math.sqrt((e.x - t.x) ** 2 + (e.y - t.y) ** 2) <= t.radius) {
              const heal = Math.abs(t.damage);
              e.hp = Math.min(e.maxHp, e.hp + heal);
              t.owner.healingDone += heal;
              this.callbacks.onHeal?.(e, heal, e.x, e.y);
            }
          }
        } else {
          for (const e of this.state.entities) {
            if (e.team === t.owner.team || e.dead) continue;
            if (Math.sqrt((e.x - t.x) ** 2 + (e.y - t.y) ** 2) <= t.radius) {
              if (t.damage > 0) {
                e.hp -= t.damage;
                t.owner.damageDealt += t.damage;
                e.damageTaken += t.damage;
                this.callbacks.onDamage?.(e, t.damage, e.x, e.y);
                if (e.hp <= 0) this.killEntity(e, t.skillName);
              }
              if (t.stunDuration > 0) e.stunTimer = Math.max(e.stunTimer, t.stunDuration);
            }
          }
        }
        { const th = worldToHex(t.x, t.y); if (t.fieldEffect) this.applyFieldEffect(t.fieldEffect, th.col, th.row, Math.ceil(t.radius), t.owner); }
        this.callbacks.onTelegraphDetonate?.(t.x, t.y, t.radius, t.color, t.isHeal, t.skillVfx);
      }
    }
    this.state.telegraphs = this.state.telegraphs.filter(t => t.delay > 0);
  }

  // ─── 전투 ───

  autoAttack(e: Entity, target: Entity) {
    if (target.dead || target.invincibleTimer > 0) return;
    if (e.skillCasting > 0 || e.skillRecovery > 0) return;
    const dist = Math.sqrt((target.x - e.x) ** 2 + (target.y - e.y) ** 2);
    // 팀 공유 시야 밖 적은 공격 불가 (동료가 밝혔으면 OK)
    if (!this.isTeamVisible(e.team, target.x, target.y)) return;
    if (!this.nav.hasLineOfSight(e.x, e.y, target.x, target.y)) return;
    if (dist <= e.attackRange && e.attackCooldown <= 0) {
      e.attackCooldown = 1 / e.attackSpeed;
      e.facingAngle = Math.atan2(target.y - e.y, target.x - e.x);

      if (e.attackRange <= 3) {
        const attackAngle = Math.PI * 0.8;
        const aDiff = angleDiffAbs(e.facingAngle, Math.atan2(target.y - e.y, target.x - e.x));
        if (aDiff <= attackAngle / 2 && dist <= e.attackRange) {
          let dmg = Math.round(e.attackDamage * getDamageMultiplier(e) * this.getElementDamageMult(e));
          // 후방 타격 보너스: 고속 근접(암살자)가 적의 등 뒤(후방 90도)에서 공격 시 1.5배
          if (e.speed >= 5.5) {
            const attackerAngle = Math.atan2(e.y - target.y, e.x - target.x);
            const behindDiff = angleDiffAbs(target.facingAngle, attackerAngle);
            if (behindDiff > Math.PI * 0.75) dmg = Math.round(dmg * 1.5);
          }
          dmg = Math.round(dmg * getDefenseMultiplier(target) * this.getElementDefenseMult(target));
          target.hp -= dmg;
          e.damageDealt += dmg;
          target.damageTaken += dmg;
          this.callbacks.onMeleeHit?.(e, target, e.facingAngle);
          this.callbacks.onDamage?.(target, dmg, target.x, target.y);
          if (target.hp <= 0) this.killEntity(target, `${e.name} 일반공격`);
        } else {
          this.callbacks.onMeleeMiss?.(e);
        }
      } else {
        this.spawnProjectile(e, target, e.attackDamage, 15, 'loose', 0, 0, e.name, e.team === 'A' ? '#88ff88' : '#ff8888');
      }
    }
  }

  autoUseSkills(e: Entity, target: Entity) {
    if (target.dead) return;
    if (e.skillCasting > 0 || e.skillRecovery > 0) return;
    const dist = Math.sqrt((target.x - e.x) ** 2 + (target.y - e.y) ** 2);
    // 팀 공유 시야 밖 적은 스킬 사용 불가
    if (!this.isTeamVisible(e.team, target.x, target.y)) return;
    if (!this.nav.hasLineOfSight(e.x, e.y, target.x, target.y)) return;
    for (const s of e.skills) {
      if (s.remaining <= 0 && dist <= s.range && s.type !== 'heal') {
        this.executeSkill(e, s, target);
        break;
      }
    }
  }

  executeSkill(user: Entity, skill: Skill, target: Entity) {
    if (skill.type !== 'heal' && skill.type !== 'buff') {
      // 적 대상 스킬: 팀 공유 시야 + LOS 체크
      if (!this.isTeamVisible(user.team, target.x, target.y)) return;
      if (!this.nav.hasLineOfSight(user.x, user.y, target.x, target.y)) return;
    } else {
      // 힐/버프: 아군이므로 팀 시야 안이면 OK (벽 관통 가능)
      if (!this.isTeamVisible(user.team, target.x, target.y)) return;
    }
    // 선딜/후딜 중에는 스킬 사용 불가
    if (user.skillCasting > 0 || user.skillRecovery > 0) return;
    skill.remaining = skill.cooldown;

    // 선딜이 있으면 캐스팅 상태로 전환
    if (skill.windupTime && skill.windupTime > 0) {
      user.skillCasting = skill.windupTime;
      user.pendingSkill = { skill, target };
      user.vx = 0; user.vy = 0;
      user.facingAngle = Math.atan2(target.y - user.y, target.x - user.x);
      this.callbacks.onSkillUse?.(user, skill.name, skill.type, skill.vfx);
      return;
    }

    // 선딜 없으면 즉시 발동 + 후딜 적용
    this.executeSkillImmediate(user, skill, target);
    user.skillRecovery = skill.recoveryTime || 0;
  }

  private executeSkillImmediate(user: Entity, skill: Skill, target: Entity) {

    // 자원 지형 스킬 강화 체크
    const terrainBoost = this.getTerrainBoost(user, skill);

    const skillColors: Record<string, string> = {
      damage: '#ff4400', cc: '#4488ff', field: '#ff8800', buff: '#44ff88',
    };
    const col = skillColors[skill.type] || '#ffffff';

    // 지형 강화된 데미지/힐
    const boostedDmg = Math.round(skill.damage * terrainBoost * this.getElementDamageMult(user));
    const boostedStun = skill.stunDuration * (terrainBoost > 1 ? 1.3 : 1);
    const boostLabel = terrainBoost > 1 ? ' ⬆' : '';

    // buff 타입: 아군에게 버프 적용 (캐릭터 시트의 buffEffects에서 읽음)
    if (skill.type === 'buff' && skill.buffEffects) {
      const fx = skill.buffEffects;
      if (fx.speedMult) {
        target.buffs = target.buffs.filter(b => b.type !== 'speed');
        target.buffs.push({ type: 'speed', remaining: fx.duration, multiplier: fx.speedMult });
      }
      if (fx.damageMult) {
        target.buffs = target.buffs.filter(b => b.type !== 'damage');
        target.buffs.push({ type: 'damage', remaining: fx.duration, multiplier: fx.damageMult });
      }
      if (fx.defenseMult) {
        target.buffs = target.buffs.filter(b => b.type !== 'defense');
        target.buffs.push({ type: 'defense', remaining: fx.duration, multiplier: fx.defenseMult });
      }
      this.callbacks.onSkillUse?.(user, skill.name, skill.type, skill.vfx);
      this.callbacks.onSkillLink?.(user, target.x, target.y, skill.name, skill.type, '#88ffcc');
      this.log(`${user.name} [${skill.name}] → ${target.name}!`);
      return;
    }

    if (skill.type === 'heal') {
      this.callbacks.onSkillLink?.(user, target.x, target.y, skill.name, 'heal', '#44ff88');
      if (skill.telegraphDelay && skill.aoe > 0) {
        this.state.telegraphs.push({
          x: target.x, y: target.y, radius: skill.aoe * 0.5,
          delay: skill.telegraphDelay, maxDelay: skill.telegraphDelay,
          damage: boostedDmg, stunDuration: boostedStun,
          owner: user, color: '#44ff88', skillName: skill.name, isHeal: true,
          skillVfx: skill.vfx,
        });
      } else {
        const heal = Math.abs(boostedDmg);
        const actualHeal = Math.min(target.maxHp - target.hp, heal);
        target.hp = Math.min(target.maxHp, target.hp + heal);
        user.healingDone += actualHeal;
        this.callbacks.onHeal?.(target, heal, target.x, target.y);
        // 버프 효과가 있으면 같이 부여 (보호 바람 등)
        if (skill.buffEffects) {
          const fx = skill.buffEffects;
          if (fx.defenseMult) {
            target.buffs = target.buffs.filter(b => b.type !== 'defense');
            target.buffs.push({ type: 'defense', remaining: fx.duration, multiplier: fx.defenseMult });
          }
          if (fx.speedMult) {
            target.buffs = target.buffs.filter(b => b.type !== 'speed');
            target.buffs.push({ type: 'speed', remaining: fx.duration, multiplier: fx.speedMult });
          }
        }
      }
      { const sh = worldToHex(target.x, target.y); if (skill.fieldEffect) this.applyFieldEffect(skill.fieldEffect, sh.col, sh.row, skill.aoe || 2, user); }
      this.log(`${user.name} [${skill.name}]${boostLabel}`);
      return;
    }

    if (skill.telegraphDelay && skill.aoe > 0) {
      this.callbacks.onSkillLink?.(user, target.x, target.y, skill.name, skill.type, col);
      this.state.telegraphs.push({
        x: target.x, y: target.y, radius: skill.aoe * 0.5,
        delay: skill.telegraphDelay, maxDelay: skill.telegraphDelay,
        damage: boostedDmg, stunDuration: boostedStun,
        owner: user, fieldEffect: skill.fieldEffect, color: col,
        skillName: skill.name, isHeal: false, skillVfx: skill.vfx,
      });
      this.log(`${user.name} [${skill.name}] 준비중!${boostLabel}`);
      return;
    }

    if (skill.projectileSpeed) {
      this.spawnProjectile(user, target, boostedDmg, skill.projectileSpeed,
        skill.tracking || 'none', boostedStun, skill.aoe,
        skill.name, col, skill.fieldEffect, skill.vfx);
      this.log(`${user.name} [${skill.name}]!${boostLabel}`);
      return;
    }

    if (boostedDmg > 0 && !target.dead) {
      const finalDmg = Math.round(boostedDmg * getDefenseMultiplier(target) * this.getElementDefenseMult(target));
      target.hp -= finalDmg;
      user.damageDealt += finalDmg;
      target.damageTaken += finalDmg;
      this.callbacks.onDamage?.(target, finalDmg, target.x, target.y);
      if (target.hp <= 0) this.killEntity(target, skill.name);
    }
    if (boostedStun > 0 && !target.dead) {
      target.stunTimer = Math.max(target.stunTimer, boostedStun);
    }
    { const sh = worldToHex(target.x, target.y); if (skill.fieldEffect) this.applyFieldEffect(skill.fieldEffect, sh.col, sh.row, skill.aoe || 2, user); }
    this.callbacks.onSkillUse?.(user, skill.name, skill.type, skill.vfx);
    this.callbacks.onMeleeHit?.(user, target, user.facingAngle, skill.vfx);
    this.log(`${user.name} [${skill.name}]!`);
  }

  private spawnProjectile(owner: Entity, target: Entity, damage: number, speed: number,
    tracking: 'none' | 'loose', stunDuration: number, aoe: number,
    skillName: string, color: string, fieldEffect?: string,
    skillVfx?: { cast?: string; projectile?: string; hit?: string; scale?: number }) {
    const dx = target.x - owner.x, dy = target.y - owner.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.1) return;
    this.state.projectiles.push({
      owner, x: owner.x, y: owner.y,
      vx: (dx / d) * speed, vy: (dy / d) * speed,
      speed, damage, hitRadius: 0.4, lifetime: 3,
      tracking, target, turnRate: tracking === 'loose' ? 1.5 : 0,
      stunDuration, aoe, fieldEffect, color, skillName, skillVfx,
    });
  }

  applyFieldEffect(effect: string, cx: number, cy: number, radius: number, owner?: Entity) {
    // ─── 콤보 판정 (필드이펙트 적용 전) ───
    const combo = checkCombo(this.state.field, effect, cx, cy, this.state.time);
    if (combo) {
      const ownerTeam = owner?.team ?? null;
      const affected = applyComboEffect(combo, this.state.entities, ownerTeam);
      // 콤보로 사망한 엔티티 처리
      for (const e of affected) {
        const isHeal = combo.damage < 0;
        if (isHeal) {
          this.callbacks.onHeal?.(e, Math.abs(combo.damage), e.x, e.y);
        } else {
          this.callbacks.onDamage?.(e, combo.damage, e.x, e.y);
          if (e.hp <= 0) this.killEntity(e, `${combo.icon}${combo.name}`);
        }
      }
      this.callbacks.onCombo?.(combo.name, combo.icon, cx, cy, combo.radius, combo.damage < 0);
      this.callbacks.onLog?.(this.state.time, `${combo.icon} [콤보] ${combo.name}! (${affected.length}명 피격)`);
    }

    // ─── 기존 필드이펙트 적용 ───
    const r = Math.ceil(radius / 2);
    const hexes = hexesInRange(cx, cy, r, this.config.fieldW, this.config.fieldH);
    for (const h of hexes) {
      const nx = h.col, ny = h.row;
      const cell = this.state.field[ny][nx];
      const dist = hexDistance(cx, cy, nx, ny);
      switch (effect) {
        case 'ignite': {
          if (cell.material && cell.material.type === 'wood') {
            if (dist === 0) cell.material.temperature = 350;
            else if (dist === 1) cell.material.temperature = Math.max(cell.material.temperature, 180);
          } else if (!cell.material && dist <= 1) {
            const w = createWood(5);
            w.temperature = dist === 0 ? 350 : 180;
            cell.material = w;
          }
          break;
        }
        case 'freeze':
          if (!cell.material) cell.material = createWater(3);
          if (cell.material.type === 'water') { cell.material.temperature = 0; cell.material.thermalState = 'frozen'; }
          break;
        case 'water':
          if (!cell.material) cell.material = createWater(4);
          break;
        case 'grow':
          if (!cell.material) cell.material = createWood(3);
          break;
        case 'mud':
          if (!cell.material) { const s = createSoil(3); s.thermalState = 'damp'; cell.material = s; }
          break;
      }
    }
  }

  // ─── 공간 쿼리 / 길찾기 — NavGrid에 위임 ───

  hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    return this.nav.hasLineOfSight(x1, y1, x2, y2);
  }

  collidesWithWall(cx: number, cy: number, radius: number): boolean {
    return this.nav.collidesWithWall(cx, cy, radius);
  }

  isWallAtHex(wx: number, wy: number): boolean {
    return this.nav.isWallAtHex(wx, wy);
  }

  isWallAt(x: number, y: number): boolean {
    return this.nav.isWallAt(x, y);
  }

  findPathBFS(sx: number, sy: number, tx: number, ty: number): [number, number][] | null {
    return this.nav.findPathBFS(sx, sy, tx, ty, this.state.time);
  }

  moveToward(e: Entity, tx: number, ty: number) {
    this.nav.moveToward(e, tx, ty, this.state.time);
  }

  moveAway(e: Entity, tx: number, ty: number, factor: number) {
    this.nav.moveAway(e, tx, ty, factor);
  }

  findNearestEnemy(e: Entity): Entity | null {
    const visCheck = (this.fogA && this.fogB)
      ? (team: 'A' | 'B', x: number, y: number) => this.isTeamVisible(team, x, y)
      : undefined;
    return this.nav.findNearestEnemy(e, this.state.entities, visCheck);
  }

  findNearestEnemyIgnoreWalls(e: Entity): Entity | null {
    const visCheck = (this.fogA && this.fogB)
      ? (team: 'A' | 'B', x: number, y: number) => this.isTeamVisible(team, x, y)
      : undefined;
    return this.nav.findNearestEnemyIgnoreWalls(e, this.state.entities, visCheck);
  }

  // ─── 자원 지형 스킬 강화 ───

  private getTerrainBoost(user: Entity, skill: Skill): number {
    for (const t of this.state.terrains) {
      const dist = Math.sqrt((user.x - t.x) ** 2 + (user.y - t.y) ** 2);
      if (dist > t.boostRadius) continue;

      const info = TERRAIN_INFO[t.type];
      // 스킬 타입 또는 필드이펙트가 매칭되면 강화
      if (info.boostTypes.includes(skill.type) ||
          (skill.fieldEffect && info.boostTypes.includes(skill.fieldEffect))) {
        return info.damageMult;
      }
    }
    return 1.0;
  }

  // ─── 불타는 타일 수집 (AI 회피용) ───

  /** 대상 좌표가 해당 팀의 공유 시야(fog visible=2) 안인지 체크 */
  isTeamVisible(team: 'A' | 'B', wx: number, wy: number): boolean {
    const fog = team === 'A' ? this.fogA : this.fogB;
    if (!fog) return true; // fog 없으면 전부 가시 (시뮬레이터 등)
    return fog.isVisible(wx, wy);
  }

  /** 미탐험 타일 중 가장 가까운 것 찾기 (AI 탐험 목적) */
  private findNearestUnexplored(e: Entity): { x: number; y: number } | null {
    const fog = e.team === 'A' ? this.fogA : this.fogB;
    if (!fog) return null;

    const ex = Math.floor(e.x), ey = Math.floor(e.y);
    const maxRange = 15; // 너무 먼 곳은 탐색 X
    let bestDist = Infinity;
    let best: { x: number; y: number } | null = null;

    // 나선형 탐색 (가까운 곳부터)
    for (let r = 2; r <= maxRange; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // 외곽만
          const tx = ex + dx, ty = ey + dy;
          if (tx < 0 || ty < 0 || tx >= this.config.fieldW || ty >= this.config.fieldH) continue;
          if (this.nav.isWallAt(tx, ty)) continue;
          if (fog.getState(tx, ty) !== 0) continue; // 이미 탐험됨
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; best = { x: tx, y: ty }; }
        }
      }
      if (best) return best; // 현재 반경에서 찾으면 바로 반환
    }
    return best;
  }

  /** 타일 좌표의 원소 속성 반환 (AI용) */
  private getTileElementAt(x: number, y: number): import('./game-engine-types.js').ElementType | null {
    if (x < 0 || y < 0 || x >= this.config.fieldW || y >= this.config.fieldH) return null;
    const mat = this.state.field[y][x].material;
    if (!mat) return null;
    return getTileElement(mat.type, mat.thermalState);
  }

  private collectBurningTiles(): Array<{ x: number; y: number }> {
    const tiles: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < this.config.fieldH; y++) {
      for (let x = 0; x < this.config.fieldW; x++) {
        const mat = this.state.field[y][x].material;
        if (mat && (mat.thermalState === 'burning' || mat.thermalState === 'molten')) {
          tiles.push({ x, y });
        }
      }
    }
    return tiles;
  }

  // ─── AI 컨텍스트 ───

  getAIContext(): AIWorldContext {
    return {
      entities: this.state.entities,
      points: this.state.points,
      terrains: this.state.terrains.map(t => ({
        type: t.type, x: t.x, y: t.y, radius: t.radius, boostRadius: t.boostRadius,
        boostTypes: TERRAIN_INFO[t.type].boostTypes,
      })),
      items: this.state.items,
      hazardZones: this.state.mapEvents.events
        .filter(e => e.remaining > 0 && (e.phase === 'warning' || e.phase === 'active'))
        .filter(e => e.type === 'volcanic' || e.type === 'flood')
        .map(e => ({ x: e.x, y: e.y, radius: e.radius, type: e.type })),
      telegraphs: this.state.telegraphs.map(t => ({
        x: t.x, y: t.y, radius: t.radius, delay: t.delay, owner: t.owner, isHeal: t.isHeal,
      })),
      burningTiles: this.collectBurningTiles(),
      tileElementAt: (x, y) => this.getTileElementAt(x, y),
      fieldW: this.config.fieldW,
      fieldH: this.config.fieldH,
      time: this.state.time,
      isInVision: (team, x, y) => {
        const fog = team === 'A' ? this.fogA : this.fogB;
        return fog ? fog.isVisible(x, y) : true; // fog 없으면 전부 가시
      },
      isExplored: (team, x, y) => {
        const fog = team === 'A' ? this.fogA : this.fogB;
        return fog ? fog.isExplored(x, y) : true;
      },
      findNearestUnexplored: (e) => this.findNearestUnexplored(e),
      hasLineOfSight: (x1, y1, x2, y2) => this.nav.hasLineOfSight(x1, y1, x2, y2),
      isWallAt: (x, y) => this.nav.isWallAt(x, y),
      findPathBFS: (sx, sy, tx, ty) => this.findPathBFS(sx, sy, tx, ty),
      moveToward: (e, tx, ty) => this.moveToward(e, tx, ty),
      moveAway: (e, tx, ty, f) => this.moveAway(e, tx, ty, f),
      autoAttack: (e, t) => this.autoAttack(e, t),
      autoUseSkills: (e, t) => this.autoUseSkills(e, t),
      executeSkill: (u, s, t) => this.executeSkill(u, s, t),
      findNearestEnemy: (e) => this.findNearestEnemy(e),
      findNearestEnemyIgnoreWalls: (e) => this.findNearestEnemyIgnoreWalls(e),
      useUltimate: (e) => this.useUltimate(e),
    };
  }

  // ─── 로그 ───

  private log(msg: string) {
    const entry = `[${this.state.time.toFixed(0)}s] ${msg}`;
    this.state.log.push(entry);
    this.callbacks.onLog?.(this.state.time, msg);
  }
}

