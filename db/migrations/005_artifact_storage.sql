create table if not exists artifact (
  id text primary key,
  user_id text not null references app_user(id) on delete cascade,
  workspace_id text not null references workspace(id) on delete cascade,
  name text not null,
  kind text not null,
  filename text not null,
  media_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null,
  storage_key text not null unique,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists idx_artifact_workspace on artifact(workspace_id);
create index if not exists idx_artifact_user on artifact(user_id);
create index if not exists idx_artifact_expiry on artifact(expires_at);
