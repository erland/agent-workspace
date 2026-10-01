alter table workspace
  alter column provider_id drop not null,
  alter column provider_workspace_id drop not null;
