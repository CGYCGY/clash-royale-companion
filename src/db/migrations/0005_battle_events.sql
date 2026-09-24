-- /events only lists events running right now, so rows are upserted and never deleted: battles from
-- an event that has ended keep their title.
CREATE TABLE events (
  event_tag TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL
);

ALTER TABLE battles ADD COLUMN event_tag TEXT;
UPDATE battles SET event_tag = json_extract(data, '$.eventTag') WHERE json_extract(data, '$.eventTag') IS NOT NULL;
