begin;
select no_plan();

select is(
  (
    select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and not relation.relrowsecurity
  ),
  0::bigint,
  'every public table enables row level security'
);

select is(
  (
    select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and not relation.relforcerowsecurity
  ),
  0::bigint,
  'every public table forces row level security for table owners'
);

select is(
  (
    select count(*)
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema = 'public'
      and lower(grant_row.grantee) in ('public', 'anon')
      and grant_row.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ),
  0::bigint,
  'public and anonymous roles have no direct public-table mutation grants'
);

select is(
  (
    select count(*)
    from information_schema.role_table_grants grant_row
    join pg_namespace namespace on namespace.nspname = grant_row.table_schema
    join pg_class relation
      on relation.relnamespace = namespace.oid
     and relation.relname = grant_row.table_name
    where grant_row.table_schema = 'public'
      and lower(grant_row.grantee) = 'authenticated'
      and grant_row.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and (
        not relation.relrowsecurity
        or not relation.relforcerowsecurity
      )
  ),
  0::bigint,
  'every authenticated mutation grant remains behind enabled and forced RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.audit_events', 'UPDATE,DELETE'),
  'authenticated sessions cannot mutate protected audit history directly'
);

select * from finish();
rollback;
