create table if not exists app_user (
  id text primary key,
  display_name text,
  status text not null check (status in ('ACTIVE','DISABLED')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists external_identity (
  id text primary key,
  user_id text not null references app_user(id) on delete cascade,
  issuer text not null,
  subject text not null,
  email text,
  created_at timestamptz not null,
  unique (issuer, subject)
);

create index if not exists idx_external_identity_user on external_identity(user_id);

create table if not exists execution_account (
  id text primary key,
  user_id text not null unique references app_user(id) on delete cascade,
  provider text not null check (provider in ('modal')),
  provider_account_id text,
  credential_ref text not null,
  status text not null check (status in ('CONNECTED','DISCONNECTED','REVOKED')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists workspace (
  id text primary key,
  user_id text not null references app_user(id) on delete cascade,
  provider_id text not null,
  provider_workspace_id text not null,
  runtime_profile text not null,
  status text not null check (status in ('CREATING','READY','DESTROYED','EXPIRED')),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  destroyed_at timestamptz,
  project_json jsonb,
  prototype_json jsonb
);

create index if not exists idx_workspace_user on workspace(user_id);
create index if not exists idx_workspace_expiry on workspace(status, expires_at);
