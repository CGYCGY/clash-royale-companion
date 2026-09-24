-- fetched_at is when a state was first observed; last_seen_at is the latest sync that returned the
-- identical payload (unchanged syncs update it instead of inserting a duplicate row).
ALTER TABLE player_snapshots ADD COLUMN last_seen_at TEXT;
UPDATE player_snapshots SET last_seen_at = fetched_at;
