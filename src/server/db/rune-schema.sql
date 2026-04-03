-- ═══════════════════════════════════════════════════
-- 룬 시스템 DB 스키마 (SQLite)
-- ═══════════════════════════════════════════════════

-- ■ 시길 (영구 룬)
CREATE TABLE IF NOT EXISTS sigils (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_wallet    TEXT NOT NULL,
  grade           TEXT NOT NULL,     -- Common/Uncommon/Rare/Legendary
  element         TEXT NOT NULL,     -- fire/water/earth/nature
  primary_stat    TEXT NOT NULL,
  primary_value   REAL NOT NULL,
  secondary1_stat TEXT,
  secondary1_val  REAL,
  secondary2_stat TEXT,
  secondary2_val  REAL,
  secondary3_stat TEXT,
  secondary3_val  REAL,
  unique_effect   TEXT,              -- Legendary only
  fortem_status   TEXT NOT NULL DEFAULT 'LOCAL',  -- LOCAL/MINTED/REDEEMED
  fortem_redeem   TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sigils_owner ON sigils(owner_wallet);
CREATE INDEX IF NOT EXISTS idx_sigils_grade ON sigils(grade);

-- ■ 시길 장착 (캐릭터별)
CREATE TABLE IF NOT EXISTS sigil_equips (
  wallet        TEXT NOT NULL,
  character_id  TEXT NOT NULL,       -- 'blaze', 'terra', ...
  slot_index    INTEGER NOT NULL,    -- 0~4
  sigil_id      INTEGER NOT NULL REFERENCES sigils(id),
  UNIQUE(wallet, character_id, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_sigil_equips_wallet ON sigil_equips(wallet);

-- ■ 글리프 인벤토리
CREATE TABLE IF NOT EXISTS glyph_inventory (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_wallet    TEXT NOT NULL,
  glyph_type      TEXT NOT NULL,     -- 'flame_spread', 'stability', ...
  grade           TEXT NOT NULL,     -- Common/Uncommon/Rare
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_glyph_inv_owner ON glyph_inventory(owner_wallet);

-- ■ 글리프 장착 (매치 시작 시 세팅, 종료 시 삭제)
CREATE TABLE IF NOT EXISTS glyph_equips (
  wallet      TEXT NOT NULL,
  slot_index  INTEGER NOT NULL,      -- 0~1
  glyph_id    INTEGER NOT NULL REFERENCES glyph_inventory(id),
  UNIQUE(wallet, slot_index)
);
