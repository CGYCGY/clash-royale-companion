-- Entered by the player: the official API exposes neither. NULL means not entered.
CREATE TABLE player_resources (
  player_tag TEXT PRIMARY KEY REFERENCES players(tag) ON DELETE CASCADE,
  gold INTEGER CHECK (gold >= 0),
  gems INTEGER CHECK (gems >= 0),
  updated_at TEXT NOT NULL
);
