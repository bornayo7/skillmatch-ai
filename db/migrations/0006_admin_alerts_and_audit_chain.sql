-- Add audit-chain columns. Existing rows are repaired after SQL migrations by
-- scripts/migrate.mjs using the exact same hashing algorithm as runtime code.
-- Keeping the backfill in application code avoids a second incompatible SQL
-- hashing implementation and does not require pgcrypto.
alter table audit_events
  add column if not exists actor_role text,
  add column if not exists actor_name text,
  add column if not exists previous_hash text not null default '0000000000000000000000000000000000000000000000000000000000000000',
  add column if not exists hash text;

create table if not exists admin_alerts (
  id uuid primary key,
  source text not null,
  severity text not null check (severity in ('info','warning','critical')),
  status text not null default 'open' check (status in ('open','resolved')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

create index if not exists admin_alerts_status_idx on admin_alerts (status);
create index if not exists admin_alerts_created_at_idx on admin_alerts (created_at desc);
