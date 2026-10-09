-- Must stay byte-identical to variantKeyOf() in src/repos/battles.ts. Only the first 8 team_deck cards are
-- the player's (2v2 appends the teammate's 8). group_concat's ORDER BY needs SQLite 3.44+ (Bun bundles 3.53);
-- BINARY collation matches JS's default sort for the ASCII card names.
-- No index: stats group by variant_key within a player_tag/time range already served by battles_tag_time,
-- the same as deck_key.
ALTER TABLE battles ADD COLUMN variant_key TEXT NOT NULL DEFAULT '';
UPDATE battles SET variant_key = COALESCE((
  SELECT group_concat(entry, '|' ORDER BY entry) FROM (
    SELECT json_extract(value, '$.name') || CASE COALESCE(json_extract(value, '$.evolutionLevel'), 0) & 3
        WHEN 1 THEN ':evo' WHEN 2 THEN ':hero' WHEN 3 THEN ':evo+hero' ELSE '' END AS entry
    FROM json_each(battles.team_deck) WHERE key < 8
  )
), '');
