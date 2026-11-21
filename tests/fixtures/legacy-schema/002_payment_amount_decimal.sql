-- Existing integer payment values fit in DECIMAL(12,2) without loss.
ALTER TABLE payments MODIFY amount DECIMAL(12,2) NOT NULL;
