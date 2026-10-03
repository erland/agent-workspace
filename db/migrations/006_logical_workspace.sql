alter table workspace
  drop constraint if exists workspace_ready_requires_provider;
