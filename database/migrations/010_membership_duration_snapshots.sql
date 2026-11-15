-- Original signup duration cannot be inferred safely from the current catalog or dates.
-- Existing records stay NULL and retain their authoritative start/end dates.
ALTER TABLE registration_info ADD COLUMN IF NOT EXISTS plan_months INT NULL;
