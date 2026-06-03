-- 018: audit_log.actor_id was created without an ON DELETE rule (defaults to
-- RESTRICT/NO ACTION), so deleting any staff/admin who had performed a logged
-- action failed with a foreign-key violation (delete-staff "not working").
-- Switch it to ON DELETE SET NULL: the audit row survives, the actor is nulled.

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey;
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;
