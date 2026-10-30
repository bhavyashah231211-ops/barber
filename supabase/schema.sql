-- Run once in Supabase > SQL Editor
create table if not exists cbs_biz(
  id text primary key,            -- business id used in links, e.g. happypaws
  name text not null,
  active boolean not null default true,
  key_hash text not null,         -- SHA-256 of the staff key (the key itself is never stored)
  data jsonb not null,
  ts bigint not null,
  created timestamptz not null default now());
alter table cbs_biz enable row level security;  -- no policies: only the function can read/write
