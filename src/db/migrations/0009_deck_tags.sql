-- JSON array of the user's mode tags for the deck, e.g. ["Clan War", "Triple Elixir"].
ALTER TABLE decks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
