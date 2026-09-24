-- isTwoVsTwo used to be inferred from team_deck length, which misflags 1v1 modes with more than 8 cards.
ALTER TABLE battles ADD COLUMN team_size INTEGER NOT NULL DEFAULT 1;
UPDATE battles SET team_size = MAX(1, COALESCE(json_array_length(data, '$.team'), 1));
