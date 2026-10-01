alter table workspace
  alter column provider_id drop not null,
  alter column provider_workspace_id drop not null;

alter table workspace
  add constraint workspace_provider_handle_pair
    check ((provider_id is null) = (provider_workspace_id is null)),
  add constraint workspace_ready_requires_provider
    check (status <> 'READY' or provider_id is not null);
