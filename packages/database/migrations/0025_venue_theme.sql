-- The look a race is run under. Existing races keep the value their kind
-- implied, so nothing that has already been run changes appearance.
ALTER TABLE races ADD COLUMN venue_theme TEXT NOT NULL DEFAULT 'standard';

UPDATE races SET venue_theme = 'night' WHERE kind = 'saturday_night';
