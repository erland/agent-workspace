create table if not exists execution_credential (
  ref text primary key,
  user_id text not null unique references app_user(id) on delete cascade,
  provider text not null check (provider in ('modal')),
  iv text not null,
  ciphertext text not null,
  auth_tag text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_execution_credential_user on execution_credential(user_id);
