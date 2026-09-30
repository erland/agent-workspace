create table if not exists oauth_client (
  client_id text primary key,
  redirect_uris jsonb not null,
  client_name text,
  created_at timestamptz not null
);

create table if not exists oauth_authorization_code (
  code_hash text primary key,
  client_id text not null,
  redirect_uri text not null,
  user_id text not null references app_user(id) on delete cascade,
  scope text not null,
  resource text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null
);

create index if not exists idx_oauth_code_expiry on oauth_authorization_code(expires_at);

create table if not exists oauth_refresh_token (
  token_hash text primary key,
  client_id text not null,
  user_id text not null references app_user(id) on delete cascade,
  scope text not null,
  resource text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null
);

create index if not exists idx_oauth_refresh_expiry on oauth_refresh_token(expires_at);
