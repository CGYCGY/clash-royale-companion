-- Deck slot 3 can hold its card as Evo or Hero. NULL = default (Evo when the card has both forms).
ALTER TABLE decks ADD COLUMN slot3_form TEXT CHECK (slot3_form IN ('evo', 'hero'));
