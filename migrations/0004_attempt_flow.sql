-- Preserve historical flow membership even after a student is moved.
-- No foreign key: deleting an empty flow must not erase historical attribution.
ALTER TABLE attempts ADD COLUMN group_id_snapshot TEXT;
UPDATE attempts SET group_id_snapshot=(SELECT g.id FROM groups g WHERE g.name=attempts.group_name)
WHERE group_name<>'';
CREATE INDEX idx_attempt_flow_started ON attempts(group_id_snapshot,started_at);
