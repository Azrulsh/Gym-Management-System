-- MariaDB: freeze fees per membership; never infer historical fees from payments.
ALTER TABLE registration_info
  ADD COLUMN IF NOT EXISTS plan_fee DECIMAL(12,2) NULL,
  ADD COLUMN IF NOT EXISTS package_fee DECIMAL(12,2) NULL,
  ADD COLUMN IF NOT EXISTS trainer_fee_snapshot DECIMAL(12,2) NULL,
  ADD COLUMN IF NOT EXISTS price_source VARCHAR(24) NOT NULL DEFAULT 'legacy_unrecorded',
  ADD COLUMN IF NOT EXISTS prices_recorded_at DATETIME NULL;

-- Upgrade-time baseline, NOT proof of original agreed prices. Missing fees stay NULL.
-- Re-importing never overwrites a captured or previously baselined fee.
UPDATE registration_info r
LEFT JOIN plans p ON p.id=r.plan_id
LEFT JOIN packages pp ON pp.id=r.package_id
LEFT JOIN trainers t ON t.id=r.trainer_id
SET r.plan_fee=p.amount, r.package_fee=pp.amount,
    r.trainer_fee_snapshot=CASE WHEN r.trainer_id=0 THEN 0 ELSE t.rate END,
    r.price_source='migration_baseline', r.prices_recorded_at=CURRENT_TIMESTAMP
WHERE r.price_source='legacy_unrecorded';
