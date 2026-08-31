alter table candidate_recommendations
  add column if not exists duplicate_key text;

create unique index if not exists candidate_recommendations_duplicate_key_idx
  on candidate_recommendations (duplicate_key)
  where duplicate_key is not null;

alter table analyses
  add column if not exists candidate_id uuid;

create index if not exists analyses_candidate_id_idx on analyses (candidate_id);

-- Best-effort link for existing records. New uploads always persist candidate_id
-- explicitly, so this compatibility backfill is only for rows created before 0007.
update analyses a
   set candidate_id = matched.id
  from lateral (
    select c.id
      from candidate_recommendations c
     where lower(c.candidate_name) = lower(a.employee_name)
     order by abs(extract(epoch from (c.created_at - a.created_at))) asc, c.created_at desc
     limit 1
  ) matched
 where a.candidate_id is null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'analyses_candidate_id_candidate_recommendations_id_fk'
  ) then
    alter table analyses
      add constraint analyses_candidate_id_candidate_recommendations_id_fk
      foreign key (candidate_id)
      references candidate_recommendations(id)
      on delete cascade;
  end if;
end $$;

-- The audit chain itself is repaired by scripts/migrate.mjs before this unique
-- index is created there. Creating it only after repair avoids rejecting a
-- legitimate upgrade whose historical rows still share the genesis predecessor.
