begin;
select no_plan();

select has_table('public', 'project_command_idempotency', 'project command ledger exists');
select has_table('public', 'task_command_idempotency', 'task command ledger exists');
select has_table('public', 'approval_command_idempotency', 'approval command ledger exists');
select has_table('public', 'approval_action_idempotency', 'approval action ledger exists');
select has_table('public', 'expense_command_idempotency', 'expense command ledger exists');

select col_is_pk(
  'public', 'project_command_idempotency', array['tenant_id', 'operation', 'idempotency_key'],
  'project command idempotency is tenant-scoped and atomic'
);
select col_is_pk(
  'public', 'task_command_idempotency', array['tenant_id', 'operation', 'idempotency_key'],
  'task command idempotency is tenant-scoped and atomic'
);
select col_is_pk(
  'public', 'approval_command_idempotency', array['tenant_id', 'operation', 'idempotency_key'],
  'approval submission idempotency is tenant-scoped and atomic'
);
select col_is_pk(
  'public', 'approval_action_idempotency', array['tenant_id', 'request_id'],
  'approval action request id is tenant-scoped and atomic'
);
select col_is_pk(
  'public', 'expense_command_idempotency', array['tenant_id', 'operation', 'idempotency_key'],
  'expense command idempotency is tenant-scoped and atomic'
);

select is(
  (
    select count(*)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any (array[
        'create_current_project_v2',
        'transition_current_task',
        'submit_current_approval',
        'act_on_current_approval',
        'submit_current_expense',
        'mark_current_expense_paid',
        'enqueue_commercial_notification',
        'mark_current_notification_read'
      ])
      and procedure.prosecdef
      and array_to_string(procedure.proconfig, ',') = 'search_path=""'
  ),
  8::bigint,
  'commercial write RPCs are security-definer transactions with an empty search path'
);

select ok(
  has_column('public', 'projects', 'version')
  and has_column('public', 'tasks', 'version')
  and has_column('public', 'approvals', 'version')
  and has_column('public', 'expense_reports', 'version')
  and has_column('public', 'commercial_notifications', 'version'),
  'commercial mutable entities carry optimistic concurrency versions'
);

select is(
  (
    select count(*)
    from pg_index index_row
    join pg_class table_row on table_row.oid = index_row.indrelid
    join pg_namespace namespace on namespace.oid = table_row.relnamespace
    where namespace.nspname = 'public'
      and table_row.relname = 'commercial_notifications'
      and index_row.indisunique
      and pg_get_indexdef(index_row.indexrelid) like '%tenant_id, organization_id, recipient_member_id, event_public_id%'
  ),
  1::bigint,
  'commercial notification events are idempotent per tenant recipient'
);

select * from finish();
rollback;
