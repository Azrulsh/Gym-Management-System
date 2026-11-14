-- Legacy payments retain NULL; each new form submission has a unique request key.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS request_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE INDEX IF NOT EXISTS payments_request_key_unique (request_key);
