/**
 * GameRoom — 하나의 멀티플레이 방 = GameEngine 인스턴스 + 틱 루프
 */

import { WebSocket } from 'ws';
import { Entity } from '@shared/combat-entities.js';
import type { SigilEffect } from '@shared/rune/sigil-types.js';
import type { GlyphEffect } from '@shared/rune/glyph-types.js';
import { GameEngine, CapturePoint, Wall, ResourceTerrain } from '@engine/game-engine.js';
import { runAI, clearAIStrategies } from '@engine/ai-module.js';
import { createFieldGrid } from '@physics/tick-engine.js';
// materials import 제거됨 — generateFieldTerrain()이 map-data에서 처리
import {
  LobbyPlayer, S2C, C2S, CompactEntity, CompactProjectile,
  CompactTelegraph, CompactPoint, CompactSkill, GameEvent,
  SerializedCell, TileChange, round2,
} from '@shared/protocol.js';
import { FIELD_W, FIELD_H, SPAWN_A, SPAWN_B, createPoints as mapPoints, createWalls as mapWalls, createTerrains as mapTerrains, generateFieldTerrain } from '@shared/map-data.js';
import { ALL_CHARS, pickBalancedTeam, SHEETS } from '@shared/char-defs.js';
import { calculateRewards, toMatchEntity, type PlayerReward, type EntityExtras } from './reward-calculator.js';

/** 매치 종료 리포트 (노드 → 중앙서버 전달용) */
export interface MatchEndReport {
  roomId: string;
  winner: 'A' | 'B';
  scoreA: number;
  scoreB: number;
  durationSec: number;
  matchMode?: MatchMode;
  players: {
    wallet: string;
    entityId: string;
    entityName: string;
    team: 'A' | 'B';
    role: string;
    kills: number;
    deaths: number;
    assists: number;
    captures: number;
    defends: number;
    damageDealt: number;
    healingDone: number;
    activeTicks: number;
    totalTicks: number;
    isHuman: boolean;
    isNft: boolean;
    element?: string;
  }[];
  eventCounters?: import('@engine/game-engine-types.js').MatchEventCounters;
}

// FIELD_W, FIELD_H, SPAWN_A, SPAWN_B는 shared/map-data.ts에서 import
const TICK_RATE = 16;  // Hz
const TICK_MS = Math.round(1000 / TICK_RATE);
const DT = 1 / TICK_RATE;
const WIN_SCORE = 120;
const RESPAWN_TIME = 5;

// ─── 플레이어 연결 ───

interface PlayerConn {
  ws: WebSocket;
  id: string;
  name: string;
  team: 'A' | 'B';
  charIndex: number;
  ready: boolean;
  entityId: string | null;
  wallet: string;           // Sui 지갑 (미연결 시 'local:{id}')
  // 최신 입력
  input: { mx: number; my: number; skills: number[]; attack: boolean };
}

export type RoomPhase = 'lobby' | 'game' | 'ended';
export type MatchMode = 'normal' | 'runed' | 'ranked_runed';

/** 룬전 진입 시 플레이어별 룬 데이터 */
export interface PlayerRuneData {
  wallet: string;
  /** 캐릭터별 시길 효과 (characterId → SigilEffect) */
  sigilEffects: Map<string, SigilEffect>;
  /** 장착 글리프 (최대 2개) */
  glyphEffects: GlyphEffect[];
}

export class GameRoom {
  id: string;
  players: PlayerConn[] = [];
  hostId: string | null = null;
  phase: RoomPhase = 'lobby';
  matchMode: MatchMode = 'normal';
  /** 룬전 시 플레이어별 룬 데이터 */
  private playerRuneData = new Map<string, PlayerRuneData>();

  private engine: GameEngine | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private eventBuffer: GameEvent[] = [];
  private tileChangeBuffer: TileChange[] = [];
  private tickCount = 0;  // 스냅샷 주기 제어
  private matchStartTime = 0;
  /** 엔티티별 보상 추적 (entityId → extras) */
  private entityExtras = new Map<string, EntityExtras>();

  onEmpty?: () => void;
  /** 매치 종료 콜백 — 중앙서버에 결과 전달 (토큰 지급은 중앙서버만 처리) */
  onMatchEnd?: (report: MatchEndReport) => void;
  /** NFT 캐릭터 보유 맵 (wallet → Set<characterId>). 외부에서 주입 (B-2 연동) */
  nftCharacters = new Map<string, Set<string>>();
  /** 룬전 데이터 fetch 콜백 (NodeRoomManager에서 주입) */
  onFetchRuneData?: (players: Array<{ wallet: string; characterId: string; element?: string; combatRole?: string }>) => Promise<Record<string, any> | null>;
  /** 글리프 소멸 콜백 (매치 종료 시) */
  onConsumeGlyphs?: (wallets: string[]) => Promise<void>;

  constructor(id: string) {
    this.id = id;
  }

  // ─── 로비 ───

  addPlayer(ws: WebSocket, id: string, name: string, wallet?: string): boolean {
    if (this.phase !== 'lobby' || this.players.length >= 8) return false;

    // 팀 자동 배정 (균형)
    const aCount = this.players.filter(p => p.team === 'A').length;
    const bCount = this.players.filter(p => p.team === 'B').length;
    const team = aCount <= bCount ? 'A' : 'B';

    const player: PlayerConn = {
      ws, id, name, team,
      charIndex: -1,
      ready: false,
      entityId: null,
      wallet: wallet ?? `local:${id}`,
      input: { mx: 0, my: 0, skills: [], attack: false },
    };

    this.players.push(player);
    if (!this.hostId) this.hostId = id;

    this.broadcastLobby();
    return true;
  }

  removePlayer(id: string) {
    const leaving = this.players.find(p => p.id === id);

    // 게임 중 이탈 → AI로 전환
    if (this.phase === 'game' && leaving?.entityId && this.engine) {
      this.engine.playerControlledIds.delete(leaving.entityId);
    }

    this.players = this.players.filter(p => p.id !== id);

    if (this.hostId === id) {
      this.hostId = this.players.length > 0 ? this.players[0].id : null;
    }

    if (this.players.length === 0) {
      this.stop();
      this.onEmpty?.();
      return;
    }

    if (this.phase === 'lobby') {
      this.broadcastLobby();
    }
  }

  handleMessage(playerId: string, msg: C2S) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    switch (msg.type) {
      case 'pick_char':
        if (this.phase !== 'lobby') return;
        // 같은 팀에서 중복 캐릭터 불가
        const sameTeamPick = this.players.find(
          p => p.id !== playerId && p.team === player.team && p.charIndex === msg.charIndex
        );
        if (!sameTeamPick && msg.charIndex >= 0 && msg.charIndex < ALL_CHARS.length) {
          player.charIndex = msg.charIndex;
          this.broadcastLobby();
        }
        break;

      case 'set_team':
        if (this.phase !== 'lobby') return;
        const targetCount = this.players.filter(p => p.team === msg.team).length;
        if (targetCount < 4) {
          player.team = msg.team;
          player.charIndex = -1; // 팀 변경 시 캐릭 초기화
          this.broadcastLobby();
        }
        break;

      case 'ready':
        if (this.phase !== 'lobby') return;
        player.ready = !player.ready;
        this.broadcastLobby();
        break;

      case 'start_game':
        if (this.phase !== 'lobby') return;
        if (playerId !== this.hostId) {
          this.send(player.ws, { type: 'error', msg: '호스트만 시작할 수 있습니다' });
          return;
        }
        this.prepareAndStart();
        break;

      case 'input':
        if (this.phase !== 'game') return;
        // 입력값 검증
        const mx = typeof msg.mx === 'number' && isFinite(msg.mx) ? Math.max(-1, Math.min(1, msg.mx)) : 0;
        const my = typeof msg.my === 'number' && isFinite(msg.my) ? Math.max(-1, Math.min(1, msg.my)) : 0;
        const skills = Array.isArray(msg.skills) ? msg.skills.filter(s => typeof s === 'number' && s >= 0 && s < 10).slice(0, 4) : [];
        const attack = !!msg.attack;
        player.input = { mx, my, skills, attack };
        break;

      case 'activate_glyph':
        if (this.phase !== 'game' || !this.engine?.runeMode) return;
        const glyphTeamIdx = player.team === 'A' ? 0 : 1;
        this.engine.activateGlyph(glyphTeamIdx, msg.slotIndex, msg.targetHex);
        break;
    }
  }

  /** 룬전 데이터 설정 (매치 시작 전 호출) */
  setPlayerRuneData(wallet: string, data: PlayerRuneData) {
    this.playerRuneData.set(wallet, data);
  }

  // ─── 게임 시작 준비 (룬전 데이터 로딩 포함) ───

  private async prepareAndStart() {
    // 룬전 모드: 중앙서버에서 시길/글리프 데이터 가져오기
    const isRuneMode = this.matchMode === 'runed' || this.matchMode === 'ranked_runed';
    if (isRuneMode && this.onFetchRuneData) {
      const runeQueries = this.players.map(p => {
        const charId = p.charIndex >= 0 ? SHEETS[p.charIndex]?.id : undefined;
        const sheet = p.charIndex >= 0 ? SHEETS[p.charIndex] : undefined;
        return {
          wallet: p.wallet,
          characterId: charId ?? '',
          element: (sheet as any)?.element ?? 'fire',
          combatRole: (sheet as any)?.role ?? 'ranged',
        };
      }).filter(q => q.characterId);

      try {
        const data = await this.onFetchRuneData(runeQueries);
        if (data) {
          for (const [wallet, runeData] of Object.entries(data)) {
            const sigilEffects = new Map<string, SigilEffect>();
            if (runeData.sigilEffects) {
              for (const [charId, effect] of Object.entries(runeData.sigilEffects)) {
                sigilEffects.set(charId, effect as SigilEffect);
              }
            }
            this.setPlayerRuneData(wallet, {
              wallet,
              sigilEffects,
              glyphEffects: runeData.glyphEffects ?? [],
            });
          }
        }
      } catch (e) {
        console.error(`[Room ${this.id}] 룬 데이터 로딩 실패:`, e);
      }
    }
    this.startGame();
  }

  // ─── 게임 시작 ───

  private startGame() {
    clearAIStrategies();
    this.phase = 'game';

    // 캐릭터 미선택 플레이어에게 자동 배정
    this.autoAssignChars();

    // 엔티티 생성
    const entities: Entity[] = [];
    const aPlayers = this.players.filter(p => p.team === 'A');
    const bPlayers = this.players.filter(p => p.team === 'B');

    // A팀 엔티티
    const aCharIndices = this.getTeamCharIndices('A');
    for (let i = 0; i < 4; i++) {
      const charIdx = aCharIndices[i];
      const e = ALL_CHARS[charIdx].factory('A', SPAWN_A[i][0], SPAWN_A[i][1]);
      entities.push(e);
      // 플레이어 매핑
      const player = aPlayers[i];
      if (player) player.entityId = e.id;
    }

    // B팀 엔티티
    const bCharIndices = this.getTeamCharIndices('B');
    for (let i = 0; i < 4; i++) {
      const charIdx = bCharIndices[i];
      const e = ALL_CHARS[charIdx].factory('B', SPAWN_B[i][0], SPAWN_B[i][1]);
      entities.push(e);
      const player = bPlayers[i];
      if (player) player.entityId = e.id;
    }

    // 맵 생성
    const field = createFieldGrid(FIELD_W, FIELD_H);
    this.generateMap(field);

    const points = mapPoints();
    const walls = mapWalls();
    const terrains = mapTerrains();

    // 엔진 생성
    this.engine = new GameEngine(
      { fieldW: FIELD_W, fieldH: FIELD_H, winScore: WIN_SCORE, respawnTime: RESPAWN_TIME },
      this.createCallbacks()
    );

    // 플레이어 조작 캐릭터 등록
    for (const p of this.players) {
      if (p.entityId) {
        this.engine.playerControlledIds.add(p.entityId);
      }
    }

    // AI (빈 슬롯용)
    this.engine.setAIRunner((e, ctx) => runAI(e, ctx));
    this.engine.initGame(entities, points, walls, field, terrains);

    // 룬전 모드 적용
    const isRuneMode = this.matchMode === 'runed' || this.matchMode === 'ranked_runed';
    if (isRuneMode) {
      this.engine.runeMode = true;
      // 시길 효과 적용
      for (const [wallet, runeData] of this.playerRuneData) {
        const player = this.players.find(p => p.wallet === wallet);
        if (!player?.entityId) continue;
        const entity = entities.find(e => e.id === player.entityId);
        if (!entity) continue;
        const charId = SHEETS[player.charIndex]?.id;
        if (charId && runeData.sigilEffects.has(charId)) {
          entity.sigilEffect = runeData.sigilEffects.get(charId);
        }
        // 글리프는 팀 전체 공유 — 첫 번째 플레이어 것으로 세팅
        if (runeData.glyphEffects.length > 0) {
          entity.glyphEffects = [...runeData.glyphEffects];
        }
      }
      this.engine.applySigilEffects(entities);
      // 글리프 초기화
      const teamGlyphs: { teamIdx: number; glyphs: GlyphEffect[] }[] = [];
      for (const team of ['A', 'B'] as const) {
        const teamIdx = team === 'A' ? 0 : 1;
        const teamEntity = entities.find(e => e.team === team && e.glyphEffects?.length);
        if (teamEntity?.glyphEffects) {
          teamGlyphs.push({ teamIdx, glyphs: teamEntity.glyphEffects });
        }
      }
      if (teamGlyphs.length > 0) {
        this.engine.initPassiveGlyphs(teamGlyphs);
      }
    }

    // 보상 추적 초기화
    this.matchStartTime = Date.now();
    this.entityExtras.clear();
    const humanIds = new Set(this.players.map(p => p.entityId).filter(Boolean));
    // 플레이어 entityId → wallet 매핑
    const entityWalletMap = new Map<string, string>();
    for (const p of this.players) {
      if (p.entityId) entityWalletMap.set(p.entityId, p.wallet);
    }
    for (const e of entities) {
      const wallet = entityWalletMap.get(e.id);
      const charId = e.id.split('_')[0]; // 'blaze_A' → 'blaze'
      const nftSet = wallet ? this.nftCharacters.get(wallet) : undefined;
      this.entityExtras.set(e.id, {
        assists: 0, captures: 0, defends: 0,
        activeTicks: 0, totalTicks: 0,
        isHuman: humanIds.has(e.id),
        isNft: nftSet?.has(charId) ?? false,
      });
    }

    // 각 클라이언트에 game_start 전송
    const serializedField = this.serializeField(field);
    const compactEntities = entities.map(e => this.compactEntity(e));

    for (const p of this.players) {
      const startMsg: S2C = {
        type: 'game_start',
        yourEntityId: p.entityId!,
        field: serializedField,
        walls: walls.map(w => ({ x: w.x, y: w.y, type: w.type ?? 'rock' })),
        points: points.map(pt => ({
          x: pt.x, y: pt.y, radius: pt.radius,
          owner: pt.owner, progress: pt.progress, capturingTeam: pt.capturingTeam,
        })),
        terrains: terrains.map(t => ({
          type: t.type, x: t.x, y: t.y, radius: t.radius, boostRadius: t.boostRadius,
        })),
        entities: compactEntities,
        config: { fieldW: FIELD_W, fieldH: FIELD_H, winScore: WIN_SCORE },
      };
      this.send(p.ws, startMsg);
    }

    // 틱 루프 시작
    this.tickInterval = setInterval(() => this.gameTick(), TICK_MS);
  }

  // ─── 게임 틱 ───

  private gameTick() {
    if (!this.engine || this.phase !== 'game') return;

    this.tickCount++;
    const tickStart = performance.now();

    // 플레이어 입력 적용
    for (const p of this.players) {
      if (!p.entityId) continue;
      const entity = this.engine.state.entities.find(e => e.id === p.entityId);
      if (!entity || entity.dead) continue;

      const { mx, my, skills, attack } = p.input;
      const mag = Math.sqrt(mx * mx + my * my);
      const hasInput = mag > 0.1 || skills.length > 0 || attack;

      // 입력 없으면 AI에게 위임 (playerControlledIds에서 제거)
      if (!hasInput) {
        this.engine.playerControlledIds.delete(p.entityId);
        continue;
      }
      // 입력 있으면 플레이어 조작 (AI 비활성)
      this.engine.playerControlledIds.add(p.entityId);

      // 이동
      if (mag > 0.1) {
        entity.vx = (mx / mag) * entity.speed;
        entity.vy = (my / mag) * entity.speed;
        entity.facingAngle = Math.atan2(my, mx);
      } else {
        entity.vx = 0;
        entity.vy = 0;
      }

      // 스킬 사용
      if (skills.length > 0) {
        const target = this.engine.findNearestEnemy(entity);
        if (target) {
          for (const si of skills) {
            if (si >= 0 && si < entity.skills.length) {
              const skill = entity.skills[si];
              if (skill.remaining <= 0) {
                this.engine.executeSkill(entity, skill, target);
              }
            }
          }
        }
      }

      // 자동 공격
      if (attack) {
        const target = this.engine.findNearestEnemy(entity);
        if (target) {
          this.engine.autoAttack(entity, target);
        }
      }

      // 입력 소비 (스킬만 — 이동은 유지)
      p.input.skills = [];
      p.input.attack = false;
    }

    // 보상 추적: activeTicks / totalTicks 업데이트
    // activeTicks = 플레이어가 접속 중인 틱 (입력 유무와 무관)
    // playerControlledIds는 AI 이동 위임용이지 보상 추적용이 아님
    const connectedEntityIds = new Set(this.players.map(p => p.entityId).filter(Boolean));
    for (const e of this.engine.state.entities) {
      const ext = this.entityExtras.get(e.id);
      if (ext) {
        ext.totalTicks++;
        if (connectedEntityIds.has(e.id)) ext.activeTicks++;
      }
    }

    // 엔진 틱
    this.engine.tick(DT);

    // 스냅샷 브로드캐스트 (매 틱 = 16Hz)
    this.broadcastSnapshot();

    // 이벤트 브로드캐스트
    if (this.eventBuffer.length > 0) {
      this.broadcast({ type: 'events', list: this.eventBuffer });
      this.eventBuffer = [];
    }

    // 타일 변경 브로드캐스트
    if (this.tileChangeBuffer.length > 0) {
      this.broadcast({ type: 'tiles', changes: this.tileChangeBuffer });
      this.tileChangeBuffer = [];
    }

    // 틱 성능 로그 (매 60틱 = ~4초마다)
    const tickMs = performance.now() - tickStart;
    if (this.tickCount % 60 === 0) {
      console.log(`[Room ${this.id}] tick #${this.tickCount} ${tickMs.toFixed(1)}ms | entities=${this.engine.state.entities.length} proj=${this.engine.state.projectiles.length} walls=${this.engine.state.walls.length} players=${this.players.length}`);
    }

    // 게임 종료 체크
    if (this.engine.state.winner) {
      // 보상 계산
      const durationSec = (Date.now() - this.matchStartTime) / 1000;
      const matchEntities = this.engine.state.entities.map(e => {
        const ext = this.entityExtras.get(e.id) ?? {
          assists: 0, captures: 0, defends: 0,
          activeTicks: 0, totalTicks: this.tickCount, isHuman: false, isNft: false,
        };
        // 엔진에서 추적한 assists/captures/defends를 extras에 반영
        ext.assists = e.assists;
        ext.captures = e.captures;
        ext.defends = e.defends;
        return toMatchEntity(e, ext);
      });

      const { players: rewards, host: hostReward } = calculateRewards({
        winner: this.engine.state.winner as 'A' | 'B',
        scoreA: this.engine.state.scoreA,
        scoreB: this.engine.state.scoreB,
        durationSec,
        entities: matchEntities,
      });

      // 룬전 보상 배율 ×1.15 + 글리프 소멸
      if (this.engine.runeMode) {
        const RUNE_REWARD_MULT = 1.15;
        for (const r of rewards) {
          if (!r.blocked) {
            r.seed = Math.round(r.seed * RUNE_REWARD_MULT);
          }
        }
        // 글리프 소멸 — 중앙서버에 DB 삭제 요청
        const runeWallets = [...this.playerRuneData.keys()];
        if (runeWallets.length > 0 && this.onConsumeGlyphs) {
          this.onConsumeGlyphs(runeWallets).catch(e =>
            console.error(`[Room ${this.id}] 글리프 소멸 실패:`, e)
          );
        }
        this.playerRuneData.clear();
      }

      // 엔티티 → 지갑 매핑
      const entityToWallet = new Map<string, string>();
      for (const p of this.players) {
        if (p.entityId) entityToWallet.set(p.entityId, p.wallet);
      }

      console.log(`[Room ${this.id}] Match ended (${durationSec.toFixed(0)}s) winner=${this.engine.state.winner}`);

      // 매치 결과 리포트 생성 → 중앙서버에 전달 (토큰 지급은 중앙서버만 처리)
      const report: MatchEndReport = {
        roomId: this.id,
        winner: this.engine.state.winner as 'A' | 'B',
        scoreA: this.engine.state.scoreA,
        scoreB: this.engine.state.scoreB,
        durationSec,
        matchMode: this.matchMode,
        players: matchEntities.map(me => ({
          wallet: entityToWallet.get(me.id) ?? '',
          entityId: me.id,
          entityName: me.name,
          team: me.team,
          role: me.role,
          kills: me.kills,
          deaths: me.deaths,
          assists: me.assists,
          captures: me.captures,
          defends: me.defends,
          damageDealt: me.damageDealt,
          healingDone: me.healingDone,
          activeTicks: me.activeTicks,
          totalTicks: me.totalTicks,
          isHuman: me.isHuman,
          isNft: me.isNft,
          element: me.element,
        })),
        eventCounters: this.engine.state.eventCounters,
      };

      if (this.onMatchEnd) {
        this.onMatchEnd(report);
      }

      console.log(`  Host: $SEED ${hostReward.seed} (humans=${hostReward.humanCount})`);
      for (const r of rewards) {
        if (!r.blocked) {
          const aiInfo = r.aiDelegationRatio != null && r.aiDelegationRatio > 0
            ? ` AI위임=${(r.aiDelegationRatio * 100).toFixed(0)}%(×${r.aiMultiplier})` : '';
          console.log(`  ${r.entityName}(${r.team}/${r.role}): HP=${r.hashPower} → $SEED ${r.seed}${aiInfo}`);
        } else {
          console.log(`  ${r.entityName}(${r.team}): BLOCKED — ${r.blockReason}`);
        }
      }

      this.broadcast({
        type: 'game_over',
        winner: this.engine.state.winner,
        scoreA: Math.floor(this.engine.state.scoreA),
        scoreB: Math.floor(this.engine.state.scoreB),
        rewards: rewards.map(r => ({
          entityId: r.entityId, name: r.entityName, team: r.team, role: r.role,
          seed: r.seed, hashPower: r.hashPower,
          blocked: r.blocked,
          aiDelegationRatio: r.aiDelegationRatio,
          aiMultiplier: r.aiMultiplier,
        })),
      });
      this.phase = 'ended';
      this.stop();
    }
  }

  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  // ─── 직렬화 ───

  /** 풀 엔티티 (game_start 용) */
  private compactEntity(e: Entity): CompactEntity {
    return {
      id: e.id, x: round2(e.x), y: round2(e.y),
      vx: round2(e.vx), vy: round2(e.vy),
      hp: Math.round(e.hp), maxHp: e.maxHp,
      fa: round2(e.facingAngle),
      dead: e.dead, rt: round2(e.respawnTimer),
      it: round2(e.invincibleTimer),
      st: round2(e.stunTimer), bt: round2(e.burnTimer),
      sht: round2(e.shockTimer), blt: round2(e.blindTimer), fzt: round2(e.freezeTimer),
      ds: e.dashing,
      sr: e.skills.map(s => round2(s.remaining)),
      k: e.kills, d: e.deaths,
      dd: Math.round(e.damageDealt), hd: Math.round(e.healingDone),
      name: e.name, team: e.team, role: e.role,
      color: e.color, size: e.size, speed: e.speed,
      attackDamage: e.attackDamage, attackRange: e.attackRange,
      skills: e.skills.map(s => ({
        name: s.name, cooldown: s.cooldown,
        remaining: round2(s.remaining), damage: s.damage,
        range: s.range, type: s.type,
      })),
    };
  }

  /** 경량 엔티티 (스냅샷용 — 변하지 않는 필드 제외) */
  private lightEntity(e: Entity): CompactEntity {
    return {
      id: e.id, x: round2(e.x), y: round2(e.y),
      vx: round2(e.vx), vy: round2(e.vy),
      hp: Math.round(e.hp), maxHp: e.maxHp,
      fa: round2(e.facingAngle),
      dead: e.dead, rt: round2(e.respawnTimer),
      it: round2(e.invincibleTimer),
      st: round2(e.stunTimer), bt: round2(e.burnTimer),
      sht: round2(e.shockTimer), blt: round2(e.blindTimer), fzt: round2(e.freezeTimer),
      ds: e.dashing,
      sr: e.skills.map(s => round2(s.remaining)),
      k: e.kills, d: e.deaths,
      dd: Math.round(e.damageDealt), hd: Math.round(e.healingDone),
      // 불변 필드는 빈값 (클라이언트가 game_start에서 받은 걸 유지)
      name: '', team: e.team, role: e.role,
      color: '', size: 0, speed: 0,
      attackDamage: 0, attackRange: 0,
      skills: [],
    };
  }

  private broadcastSnapshot() {
    if (!this.engine) return;
    const s = this.engine.state;

    const snap: S2C = {
      type: 'snap',
      t: round2(s.time),
      e: s.entities.map(e => this.lightEntity(e)),
      p: s.projectiles.map(p => ({
        x: round2(p.x), y: round2(p.y),
        vx: round2(p.vx), vy: round2(p.vy),
        color: p.color, aoe: p.aoe, skillName: p.skillName,
      })),
      tg: s.telegraphs.map(t => ({
        x: round2(t.x), y: round2(t.y),
        radius: t.radius, delay: round2(t.delay),
        maxDelay: t.maxDelay, color: t.color,
        isHeal: t.isHeal, skillName: t.skillName,
      })),
      cp: s.points.map(pt => ({
        x: pt.x, y: pt.y, radius: pt.radius,
        owner: pt.owner, progress: round2(pt.progress),
        capturingTeam: pt.capturingTeam,
      })),
      sA: Math.floor(s.scoreA),
      sB: Math.floor(s.scoreB),
      rain: s.rain.active ? {
        active: true, intensity: round2(s.rain.intensity),
        coverLeft: round2(s.rain.coverLeft), coverRight: round2(s.rain.coverRight),
      } : null,
      winner: s.winner,
    };

    this.broadcast(snap);
  }

  private serializeField(field: ReturnType<typeof createFieldGrid>): (SerializedCell | null)[][] {
    return field.map(row =>
      row.map(cell => {
        if (!cell.material) return null;
        const m = cell.material;
        return {
          t: m.type, ts: m.thermalState,
          tp: round2(m.temperature), m: round2(m.mass),
        };
      })
    );
  }

  // ─── 콜백 (이벤트 버퍼링) ───

  private createCallbacks() {
    return {
      onKill: (victim: Entity, cause: string, killer?: Entity) => {
        this.eventBuffer.push({
          ev: 'kill', victimId: victim.id, cause,
          killerId: killer?.id,
        });
      },
      onDamage: (target: Entity, amount: number, x: number, y: number) => {
        this.eventBuffer.push({ ev: 'damage', targetId: target.id, amount: Math.round(amount), x: round2(x), y: round2(y) });
      },
      onHeal: (target: Entity, amount: number, x: number, y: number) => {
        this.eventBuffer.push({ ev: 'heal', targetId: target.id, amount: Math.round(amount), x: round2(x), y: round2(y) });
      },
      onProjectileHit: (x: number, y: number, aoe: number, color: string) => {
        this.eventBuffer.push({ ev: 'projectile_hit', x: round2(x), y: round2(y), aoe, color });
      },
      onTelegraphDetonate: (x: number, y: number, radius: number, color: string, isHeal: boolean) => {
        this.eventBuffer.push({ ev: 'telegraph_det', x: round2(x), y: round2(y), radius, color, isHeal });
      },
      onSkillUse: (user: Entity, skillName: string, skillType: string) => {
        this.eventBuffer.push({ ev: 'skill_use', userId: user.id, skillName, skillType });
      },
      onMeleeHit: (attacker: Entity, target: Entity, angle: number) => {
        this.eventBuffer.push({ ev: 'melee_hit', attackerId: attacker.id, targetId: target.id, angle: round2(angle) });
      },
      onMeleeMiss: (attacker: Entity) => {
        this.eventBuffer.push({ ev: 'melee_miss', attackerId: attacker.id });
      },
      onDash: (entity: Entity, tx: number, ty: number) => {
        this.eventBuffer.push({ ev: 'dash', entityId: entity.id, tx: round2(tx), ty: round2(ty) });
      },
      onDashHit: (attacker: Entity, target: Entity, damage: number, angle: number) => {
        this.eventBuffer.push({ ev: 'dash_hit', attackerId: attacker.id, targetId: target.id, damage: Math.round(damage), angle: round2(angle) });
      },
      onCapture: (point: CapturePoint, team: string) => {
        this.eventBuffer.push({ ev: 'capture', x: point.x, y: point.y, team });
      },
      onUltimate: (user: Entity, ultName: string, icon: string, color: string, screenColor: string) => {
        this.eventBuffer.push({
          ev: 'ultimate', userId: user.id, userName: user.name, userTeam: user.team,
          ultName, icon, color, screenColor,
          x: round2(user.x), y: round2(user.y),
        });
      },
      onCombo: (name: string, icon: string, cx: number, cy: number, radius: number, isHeal: boolean) => {
        this.eventBuffer.push({
          ev: 'combo', name, icon, x: round2(cx), y: round2(cy), radius, isHeal,
        });
      },
      onRainStart: (intensity: number, coverLeft: number, coverRight: number) => {
        this.eventBuffer.push({ ev: 'rain_start', intensity: round2(intensity), coverLeft: round2(coverLeft), coverRight: round2(coverRight) });
      },
      onRainStop: () => {
        this.eventBuffer.push({ ev: 'rain_stop' });
      },
      onRespawn: (entity: Entity) => {
        this.eventBuffer.push({ ev: 'respawn', entityId: entity.id });
      },
      onTileChange: (x: number, y: number, _from: string, _to: string, matType: string) => {
        // 타일 변경을 직렬화
        if (!this.engine) return;
        const cell = this.engine.state.field[y]?.[x];
        if (!cell) return;
        const mat = cell.material;
        this.tileChangeBuffer.push({
          x, y,
          mat: mat ? JSON.stringify({ t: mat.type, ts: mat.thermalState, tp: round2(mat.temperature), m: round2(mat.mass) }) : 'null',
        });
      },
    };
  }

  // ─── 맵 생성 (shared/map-data.ts 공용 함수 사용) ───

  private generateMap(field: ReturnType<typeof createFieldGrid>) {
    generateFieldTerrain(field);
  }

  // ─── 캐릭터 자동 배정 ───

  private autoAssignChars() {
    const usedA = new Set(this.players.filter(p => p.team === 'A' && p.charIndex >= 0).map(p => p.charIndex));
    const usedB = new Set(this.players.filter(p => p.team === 'B' && p.charIndex >= 0).map(p => p.charIndex));

    for (const p of this.players) {
      if (p.charIndex >= 0) continue;
      const used = p.team === 'A' ? usedA : usedB;
      // 역할별 1명씩 선택
      const balanced = pickBalancedTeam(used);
      if (balanced.length > 0) {
        p.charIndex = balanced[Math.floor(Math.random() * balanced.length)];
        used.add(p.charIndex);
      }
    }
  }

  private getTeamCharIndices(team: 'A' | 'B'): number[] {
    const teamPlayers = this.players.filter(p => p.team === team);
    const indices = teamPlayers.map(p => p.charIndex);
    const used = new Set(indices);

    // AI 슬롯: 역할별 1명씩 채우기
    if (indices.length < 4) {
      const aiPicks = pickBalancedTeam(used);
      for (const pick of aiPicks) {
        if (indices.length >= 4) break;
        if (!used.has(pick)) {
          indices.push(pick);
          used.add(pick);
        }
      }
    }

    return indices;
  }

  // ─── 통신 유틸 ───

  private send(ws: WebSocket, msg: S2C) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcast(msg: S2C) {
    const data = JSON.stringify(msg);
    for (const p of this.players) {
      if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(data);
      }
    }
  }

  private broadcastLobby() {
    const lobbyPlayers: LobbyPlayer[] = this.players.map(p => ({
      id: p.id, name: p.name, team: p.team,
      charIndex: p.charIndex, ready: p.ready,
    }));

    // 각 플레이어에게 자기 ID 포함해서 전송
    for (const p of this.players) {
      this.send(p.ws, {
        type: 'room_state',
        roomId: this.id,
        players: lobbyPlayers,
        hostId: this.hostId!,
        yourId: p.id,
      });
    }
  }
}
