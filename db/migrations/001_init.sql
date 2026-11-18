-- Configuration (published versions and the working draft), the decision log, and what the admin page needs.
-- Additive only: later migrations add tables or nullable columns and never rename or drop in one step.

-- every published configuration, never changed or deleted: a decision can always be replayed on the version it ran on
create table if not exists config_versions (
  version      integer primary key,
  published_at timestamptz not null default now(),
  actor        text not null default 'seed',
  note         text not null default '',
  checksum     text not null,
  doc          jsonb not null            -- { params, channels, categories, facts, rules }
);

-- the working copy the admin page edits; publishing copies it into config_versions
create table if not exists config_draft (
  id           integer primary key check (id = 1),
  doc          jsonb not null,
  base_version integer not null,
  revision     integer not null default 1,   -- raised on every save; a save names the revision it started from
  updated_at   timestamptz not null default now(),
  updated_by   text not null default 'seed'
);

create table if not exists audit_log (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  actor   text not null,
  action  text not null,                 -- save | publish | rollback | seed
  part    text,                          -- params | channels | categories | rules | facts
  item    text,                          -- the key or id that changed
  before  jsonb,
  after   jsonb,
  version integer
);
create index if not exists audit_log_at on audit_log (at desc);

-- failed admin sign-ins, counted here because function memory is lost on a cold start
create table if not exists admin_attempts (
  id bigserial primary key,
  at timestamptz not null default now(),
  ip text not null
);
create index if not exists admin_attempts_ip_at on admin_attempts (ip, at desc);

-- which rule decided what, on which configuration and from which facts. No free text, no names, no IP address.
create table if not exists decisions (
  id              bigserial primary key,
  received_at     timestamptz not null default now(),
  conversation_id uuid not null,
  seq             integer not null,
  rule_id         text not null,
  rule_row        integer not null,
  outcome         text not null,
  config_version  integer not null,
  config_source   text not null,
  config_checksum text not null,
  facts           jsonb not null,
  unique (conversation_id, seq)
);
create index if not exists decisions_received_at on decisions (received_at desc);
create index if not exists decisions_rule on decisions (rule_id, outcome);
