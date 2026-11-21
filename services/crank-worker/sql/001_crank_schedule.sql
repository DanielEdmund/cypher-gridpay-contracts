CREATE TABLE IF NOT EXISTS crank_schedule (
    id BIGSERIAL PRIMARY KEY,
    contract TEXT NOT NULL CHECK (contract IN ('payment', 'escrow', 'refund')),
    contract_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    subscription_id TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    next_run_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 10,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_tx_hash TEXT,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    UNIQUE (contract, entity_id, action_type)
);

CREATE INDEX IF NOT EXISTS idx_crank_schedule_due
    ON crank_schedule (next_run_at)
    WHERE enabled;

CREATE INDEX IF NOT EXISTS idx_crank_schedule_subscription
    ON crank_schedule (subscription_id)
    WHERE subscription_id IS NOT NULL AND enabled;

CREATE TABLE IF NOT EXISTS crank_execution_log (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL REFERENCES crank_schedule (id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    status TEXT NOT NULL,
    tx_hash TEXT,
    gas_stroops BIGINT NOT NULL DEFAULT 0,
    error_code INTEGER,
    error_message TEXT,
    next_retry_at TIMESTAMPTZ,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crank_execution_log_task
    ON crank_execution_log (task_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS crank_locks (
    lock_key TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crank_locks_expiry ON crank_locks (expires_at);

CREATE TABLE IF NOT EXISTS crank_circuit_breakers (
    subscription_id TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('closed', 'open', 'half_open')),
    failures INTEGER NOT NULL DEFAULT 0,
    opened_at TIMESTAMPTZ,
    next_probe_at TIMESTAMPTZ,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
