/**
 * 동적 맵 이벤트 시스템 — 용암, 홍수, 눈보라, 일식, 지진
 */

export type MapEventType = 'volcanic' | 'flood' | 'blizzard' | 'eclipse' | 'earthquake';

export interface MapEvent {
  type: MapEventType;
  x: number;           // 이벤트 중심 (hex col)
  y: number;           // 이벤트 중심 (hex row)
  radius: number;      // 효과 범위
  duration: number;    // 총 지속시간
  remaining: number;   // 남은 시간
  warningTime: number; // 경고 시간 (이 시간 동안은 warning 페이즈)
  phase: 'warning' | 'active' | 'ending';
}

export interface MapEventInfo {
  name: string;
  icon: string;
  color: string;
  warningDuration: number;
  activeDuration: number;
  radius: number;
  weight: number;
}

export const EVENT_INFO: Record<MapEventType, MapEventInfo> = {
  volcanic:   { name: '용암 분출', icon: '🌋', color: '#ff4400', warningDuration: 3, activeDuration: 8, radius: 5, weight: 20 },
  flood:      { name: '강 범람',   icon: '🌊', color: '#2266cc', warningDuration: 3, activeDuration: 12, radius: 8, weight: 20 },
  blizzard:   { name: '눈보라',   icon: '❄️', color: '#88ccff', warningDuration: 2, activeDuration: 12, radius: 99, weight: 20 }, // 전체 맵
  eclipse:    { name: '일식',     icon: '🌑', color: '#332244', warningDuration: 3, activeDuration: 15, radius: 99, weight: 15 },
  earthquake: { name: '지진',     icon: '🏔️', color: '#886644', warningDuration: 2, activeDuration: 3, radius: 99, weight: 25 },
};

// ─── 스케줄러 설정 ───

export const EVENT_CONFIG = {
  startDelay: 30,        // 첫 이벤트까지 대기
  minInterval: 40,       // 이벤트 간 최소 간격
  maxInterval: 80,       // 이벤트 간 최대 간격
  maxSimultaneous: 1,    // 동시 이벤트 최대 수
};

// ─── 이벤트 생성 ───

function rollEventType(): MapEventType {
  const types = Object.keys(EVENT_INFO) as MapEventType[];
  const totalWeight = types.reduce((s, t) => s + EVENT_INFO[t].weight, 0);
  let roll = Math.random() * totalWeight;
  for (const t of types) {
    roll -= EVENT_INFO[t].weight;
    if (roll <= 0) return t;
  }
  return 'earthquake';
}

export function createEvent(type: MapEventType, fieldW: number, fieldH: number): MapEvent {
  const info = EVENT_INFO[type];
  // 이벤트 위치: 맵 중앙부 (용암/홍수만 위치 의미 있음)
  let x = Math.floor(fieldW * 0.3 + Math.random() * fieldW * 0.4);
  let y = Math.floor(fieldH * 0.3 + Math.random() * fieldH * 0.4);

  // 강 범람: 하단 강에서 발생
  if (type === 'flood') {
    x = Math.floor(fieldW / 2);
    y = fieldH - 2;
  }

  const totalDuration = info.warningDuration + info.activeDuration;
  return {
    type, x, y,
    radius: info.radius,
    duration: totalDuration,
    remaining: totalDuration,
    warningTime: info.warningDuration,
    phase: 'warning',
  };
}

// ─── 이벤트 업데이트 ───

export function updateEvent(event: MapEvent, dt: number): void {
  event.remaining -= dt;
  const elapsed = event.duration - event.remaining;
  const info = EVENT_INFO[event.type];

  if (elapsed < info.warningDuration) {
    event.phase = 'warning';
  } else if (event.remaining > 2) {
    event.phase = 'active';
  } else {
    event.phase = 'ending';
  }
}

// ─── 스케줄러 ───

export interface EventSchedulerState {
  nextEventAt: number;
  events: MapEvent[];
}

export function createSchedulerState(): EventSchedulerState {
  return {
    nextEventAt: EVENT_CONFIG.startDelay + Math.random() * 20,
    events: [],
  };
}

export function tryScheduleEvent(
  scheduler: EventSchedulerState,
  gameTime: number,
  fieldW: number, fieldH: number,
): MapEvent | null {
  if (gameTime < scheduler.nextEventAt) return null;
  if (scheduler.events.filter(e => e.remaining > 0).length >= EVENT_CONFIG.maxSimultaneous) return null;

  const type = rollEventType();
  const event = createEvent(type, fieldW, fieldH);
  scheduler.events.push(event);
  scheduler.nextEventAt = gameTime + EVENT_CONFIG.minInterval + Math.random() * (EVENT_CONFIG.maxInterval - EVENT_CONFIG.minInterval);
  return event;
}

export function cleanupEvents(scheduler: EventSchedulerState): void {
  scheduler.events = scheduler.events.filter(e => e.remaining > 0);
}
