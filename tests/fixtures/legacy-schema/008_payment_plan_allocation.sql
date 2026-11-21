-- NULL preserves legacy payments whose purpose was not recorded.
-- Zero explicitly records a new payment with no allocation towards the Plan fee.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan_amount DECIMAL(12,2) NULL;
