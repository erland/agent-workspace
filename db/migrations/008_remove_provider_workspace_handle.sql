alter table workspace
  drop constraint if exists workspace_ready_requires_provider,
  drop constraint if exists workspace_provider_handle_pair;

alter table workspace
  drop column if exists provider_id,
  drop column if exists provider_workspace_id;
