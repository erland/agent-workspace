alter table workspace
  drop constraint if exists workspace_ready_requires_provider;

alter table workspace
  add constraint workspace_provider_handle_pair
    check ((provider_id is null) = (provider_workspace_id is null)) not valid;

alter table workspace validate constraint workspace_provider_handle_pair;
