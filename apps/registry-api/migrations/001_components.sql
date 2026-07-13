-- One row per published (id, version). The composite primary key is the
-- immutability guarantee: a second publish of the same pair violates it, so
-- ON CONFLICT DO NOTHING makes putComponent atomic under concurrency — no
-- read-then-write race. files/dependencies are the RegistryComponent maps.
create table if not exists components (
  id           text        not null,
  version      text        not null,
  dependencies jsonb       not null default '{}'::jsonb,
  files        jsonb       not null,
  published_at timestamptz not null default now(),
  primary key (id, version)
);

-- Metadata (version list + latest) is a scan of one id's rows.
create index if not exists components_id_idx on components (id);
