CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_user_id ON sessions(user_id);

CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX api_keys_user_id ON api_keys(user_id);

CREATE TABLE invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE players (
  tag TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL,
  last_synced_at TEXT,
  last_sync_error TEXT
);
CREATE INDEX players_user_id ON players(user_id);

CREATE TABLE player_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_tag TEXT NOT NULL REFERENCES players(tag) ON DELETE CASCADE,
  fetched_at TEXT NOT NULL,
  data TEXT NOT NULL,
  chests TEXT
);
CREATE INDEX player_snapshots_tag_time ON player_snapshots(player_tag, fetched_at);

-- opponent_tag is NOT NULL (empty string when absent) because UNIQUE treats NULLs as distinct,
-- which would silently defeat battle de-duplication.
CREATE TABLE battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_tag TEXT NOT NULL REFERENCES players(tag) ON DELETE CASCADE,
  battle_time TEXT NOT NULL,
  type TEXT NOT NULL,
  game_mode_name TEXT NOT NULL,
  arena_name TEXT,
  opponent_tag TEXT NOT NULL DEFAULT '',
  opponent_name TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  team_crowns INTEGER NOT NULL,
  opponent_crowns INTEGER NOT NULL,
  team_deck TEXT NOT NULL,
  opponent_deck TEXT NOT NULL,
  deck_key TEXT NOT NULL,
  trophy_change INTEGER,
  data TEXT NOT NULL,
  UNIQUE (player_tag, battle_time, opponent_tag)
);
CREATE INDEX battles_tag_time ON battles(player_tag, battle_time);

CREATE TABLE cards (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'card' CHECK (kind IN ('card', 'support')),
  rarity TEXT NOT NULL,
  elixir_cost INTEGER,
  max_level INTEGER NOT NULL,
  max_evolution_level INTEGER,
  icon_url TEXT,
  icon_url_evo TEXT,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX cards_name ON cards(name COLLATE NOCASE);

CREATE TABLE decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cards TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX decks_user_id ON decks(user_id);

CREATE TABLE player_notes (
  player_tag TEXT PRIMARY KEY REFERENCES players(tag) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_tag TEXT NOT NULL REFERENCES players(tag) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  battles_added INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX sync_runs_tag_started ON sync_runs(player_tag, started_at);
