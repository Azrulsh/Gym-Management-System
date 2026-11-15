-- Match trainers.id while preserving 0 as the optional no-trainer value.
ALTER TABLE registration_info MODIFY COLUMN trainer_id INT NOT NULL DEFAULT 0 COMMENT '0 = no trainer';
