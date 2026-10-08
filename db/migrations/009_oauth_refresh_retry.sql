alter table oauth_refresh_token add column if not exists rotated_at timestamptz;
create index if not exists idx_oauth_refresh_rotated_at on oauth_refresh_token(rotated_at);
