create table if not exists oa_orgs (
  org_id text primary key,
  user_id text not null,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists oa_orgs_user_idx on oa_orgs (user_id);

create table if not exists oa_agents (
  agent_id text primary key,
  org_id text not null references oa_orgs(org_id),
  user_id text not null,
  name text not null,
  role text not null,
  model text not null default 'grok-4.5',
  status text not null default 'active' check (status in ('active', 'disabled')),
  capabilities text not null default 'time.now,math.eval,market.read',
  created_at timestamptz not null default now()
);
create index if not exists oa_agents_org_idx on oa_agents (org_id);

create table if not exists oa_executions (
  execution_id text primary key,
  org_id text not null,
  agent_id text not null,
  user_id text not null,
  task text not null,
  status text not null,
  revision integer not null default 0,
  result text,
  error text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists oa_exec_user_idx on oa_executions (user_id, created_at desc);

create table if not exists oa_events (
  event_id text primary key,
  org_id text not null,
  agent_id text not null,
  execution_id text not null,
  sequence_no bigint not null,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (agent_id, execution_id, sequence_no)
);

create table if not exists oa_usage (
  usage_id text primary key,
  user_id text not null,
  org_id text not null,
  provider text not null,
  model text not null,
  request_id text not null unique,
  input_tokens integer not null,
  output_tokens integer not null,
  total_tokens integer not null,
  provider_cost numeric(18, 8) not null,
  markup numeric(18, 8) not null,
  customer_cost numeric(18, 8) not null,
  created_at timestamptz not null default now()
);

create table if not exists oa_billing (
  id text primary key,
  user_id text not null,
  stripe_event_id text unique,
  status text not null,
  plan text not null default 'paper',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists oa_audit (
  audit_id text primary key,
  domain text not null,
  user_id text,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table oa_orgs enable row level security;
alter table oa_agents enable row level security;
alter table oa_executions enable row level security;
alter table oa_events enable row level security;
alter table oa_usage enable row level security;
alter table oa_billing enable row level security;
alter table oa_audit enable row level security;
