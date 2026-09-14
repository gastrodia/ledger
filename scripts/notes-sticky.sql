-- Additive migration for existing installations. Existing note content is unchanged.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS color VARCHAR(16) NOT NULL DEFAULT 'yellow'
  CHECK (color IN ('yellow', 'pink', 'green', 'blue', 'purple'));
