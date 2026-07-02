-- schema.sql — run this once in Supabase: SQL Editor -> New query -> paste -> Run
create table if not exists flags (
  id text primary key,
  url text not null,
  norm_url text not null unique,
  url_hash text not null,
  type text not null,
  signals jsonb not null,
  note text default '',
  submitter_kind text not null,      -- 'human' | 'agent'
  submitter_key text not null,
  agent_name text,
  ts bigint not null,
  confirm integer default 1,
  dispute integer default 0
);
create index if not exists idx_flags_hash on flags (url_hash);
create index if not exists idx_flags_ts on flags (ts desc);
create index if not exists idx_flags_submitter on flags (submitter_key);

create table if not exists votes (
  flag_id text not null,
  voter_key text not null,
  side text not null,                -- 'confirm' | 'dispute'
  ts bigint not null,
  primary key (flag_id, voter_key)
);

create table if not exists submitters (
  key text primary key,
  kind text not null,
  name text,
  flags_total integer default 0,
  flags_confirmed integer default 0,
  flags_disputed integer default 0,
  created_ts bigint not null
);

-- The API talks to Postgres with the service connection string and does its
-- own permission logic, so lock the tables away from Supabase's public API:
alter table flags enable row level security;
alter table votes enable row level security;
alter table submitters enable row level security;
