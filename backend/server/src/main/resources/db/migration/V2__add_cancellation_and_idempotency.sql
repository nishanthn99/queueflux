-- Replace the status check constraint to allow the CANCELLED terminal state.
-- The original constraint was created inline (no explicit name), so we locate it
-- dynamically to avoid hardcoding the auto-generated name.
DO $$
DECLARE
    cname text;
BEGIN
    SELECT tc.constraint_name INTO cname
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name
     AND tc.constraint_schema = cc.constraint_schema
    WHERE tc.table_name = 'simulation_runs'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause LIKE '%status%';

    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE simulation_runs DROP CONSTRAINT %I', cname);
    END IF;
END;
$$;

ALTER TABLE simulation_runs
    ADD CONSTRAINT simulation_runs_status_check
    CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'));

-- Idempotency key: client-supplied token that deduplicates async submissions.
ALTER TABLE simulation_runs ADD COLUMN idempotency_key VARCHAR(255);

CREATE UNIQUE INDEX idx_simulation_runs_idempotency_key
    ON simulation_runs (idempotency_key)
    WHERE idempotency_key IS NOT NULL;
