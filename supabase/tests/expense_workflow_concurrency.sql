begin;
select plan(6);

select set_config('test.expense.concurrent.available','false',true);
select set_config('test.expense.concurrent.same_key_wait','false',true);
select set_config('test.expense.concurrent.same_key_one','false',true);
select set_config('test.expense.concurrent.race_wait','false',true);
select set_config('test.expense.concurrent.race_one','false',true);
select set_config('test.expense.concurrent.cleaned','false',true);

do $expense_workflow_concurrency$
declare
  v_extension_schema name;
  v_status text;
  v_connection text;
  v_integer integer;
  v_worker_a_pid integer;
  v_worker_b_pid integer;
  v_waiting_a boolean;
  v_waiting_b boolean;
  v_wait_count integer;
  v_busy_a integer;
  v_busy_b integer;
  v_result_a jsonb;
  v_result_b jsonb;
  v_submit jsonb;
  v_expense_id uuid;
  v_approval_id uuid;
  v_fixture_tenant bigint;
  v_count bigint;
  v_final jsonb;
  v_drain text;
  v_cleanup_sql text:=$cleanup$
    begin;
    set local session_replication_role=replica;
    delete from public.audit_logs where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.expense_receipts where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.expense_command_idempotency where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.approval_action_idempotency where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.approval_command_idempotency where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.expense_reports where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.approval_actions where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.approval_steps where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.approvals where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.approval_templates where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.project_members where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.projects where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.member_roles where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.role_permissions where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.roles where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.external_identities where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.employee_private_profiles where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.employee_profiles where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.organization_members where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.identity_providers where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.departments where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.organizations where tenant_id in (select id from public.tenants where slug='expense-concurrency');
    delete from public.tenants where slug='expense-concurrency';
    delete from auth.users where id in (
      'e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000003'
    );
    set local session_replication_role=origin;
    commit;
  $cleanup$;
begin
  begin
    select namespace.nspname into v_extension_schema
    from pg_extension extension
    join pg_namespace namespace on namespace.oid=extension.extnamespace
    where extension.extname='dblink';
    if not found then
      if not exists(select 1 from pg_available_extensions where name='dblink') then return; end if;
      begin execute 'create extension dblink with schema extensions';
      exception when undefined_schema then execute 'create extension dblink'; end;
      select namespace.nspname into strict v_extension_schema
      from pg_extension extension join pg_namespace namespace on namespace.oid=extension.extnamespace
      where extension.extname='dblink';
    end if;
    foreach v_connection in array array[
      'expense_concurrency_setup','expense_concurrency_a','expense_concurrency_b'
    ] loop
      execute format('select %I.dblink_connect($1,$2)',v_extension_schema)
        into v_status using v_connection,'dbname='||current_database();
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'set statement_timeout = ''15s''';
    end loop;
  exception when others then
    if v_extension_schema is not null then
      foreach v_connection in array array[
        'expense_concurrency_setup','expense_concurrency_a','expense_concurrency_b'
      ] loop
        begin
          execute format('select %I.dblink_disconnect($1)',v_extension_schema)
            into v_status using v_connection;
        exception when others then null; end;
      end loop;
    end if;
    return;
  end;
  perform set_config('test.expense.concurrent.available','true',true);

  -- Make retries deterministic even if a previously interrupted harness left fixtures behind.
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup',v_cleanup_sql;
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup',$setup$
      begin;
      insert into public.tenants(name,slug,status)
      values('Expense concurrency tenant','expense-concurrency','active');
      insert into public.roles(tenant_id,organization_id,code,name,description,is_system,is_enabled)
      select tenant.id,null,seed.code,seed.name,seed.description,true,true
      from public.tenants tenant
      cross join (values
        ('employee','Employee','Expense concurrency employee role'),
        ('finance','Finance','Expense concurrency finance role')
      ) seed(code,name,description)
      where tenant.slug='expense-concurrency'
      on conflict(tenant_id,code) where organization_id is null do update set
        name=excluded.name,description=excluded.description,is_system=true,is_enabled=true;
      insert into public.organizations(tenant_id,name,slug)
      select tenant.id,'Expense concurrency organization','expense-concurrency-org'
      from public.tenants tenant where tenant.slug='expense-concurrency';
      insert into public.departments(tenant_id,organization_id,code,name)
      select organization.tenant_id,organization.id,'EXP-CONCURRENCY','Expense concurrency'
      from public.organizations organization where organization.slug='expense-concurrency-org';
      insert into public.identity_providers(
        tenant_id,provider_code,auth_provider,provider_tenant_key,display_name,status
      )
      select tenant.id,'expense-concurrency','custom:expense-concurrency',
        'expense-concurrency-provider','Expense concurrency identity','active'
      from public.tenants tenant where tenant.slug='expense-concurrency';
      insert into auth.users(
        instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
        raw_app_meta_data,raw_user_meta_data,created_at,updated_at
      ) values
        ('00000000-0000-0000-0000-000000000000','e1000000-0000-4000-8000-000000000001','authenticated','authenticated','expense-concurrency-applicant@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
        ('00000000-0000-0000-0000-000000000000','e1000000-0000-4000-8000-000000000002','authenticated','authenticated','expense-concurrency-manager@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
        ('00000000-0000-0000-0000-000000000000','e1000000-0000-4000-8000-000000000003','authenticated','authenticated','expense-concurrency-finance@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());
      insert into public.organization_members(tenant_id,organization_id,user_id,status)
      select organization.tenant_id,organization.id,seed.user_id,'active'
      from (values
        ('e1000000-0000-4000-8000-000000000001'::uuid),
        ('e1000000-0000-4000-8000-000000000002'::uuid),
        ('e1000000-0000-4000-8000-000000000003'::uuid)
      ) seed(user_id)
      cross join public.organizations organization
      where organization.slug='expense-concurrency-org';
      insert into public.employee_profiles(
        public_id,tenant_id,organization_id,organization_member_id,employee_no,display_name,
        department_id,job_title,employment_type,employment_status
      )
      select seed.public_id,member.tenant_id,member.organization_id,member.id,seed.employee_no,
        seed.display_name,department.id,seed.job_title,'full_time','active'
      from (values
        ('e1100000-0000-4000-8000-000000000002'::uuid,'e1000000-0000-4000-8000-000000000002'::uuid,'EC-MANAGER','expense-concurrency-manager','Manager'),
        ('e1100000-0000-4000-8000-000000000003'::uuid,'e1000000-0000-4000-8000-000000000003'::uuid,'EC-FINANCE','expense-concurrency-finance','Finance')
      ) seed(public_id,user_id,employee_no,display_name,job_title)
      join public.organization_members member on member.user_id=seed.user_id
      join public.departments department on department.tenant_id=member.tenant_id
        and department.organization_id=member.organization_id and department.code='EXP-CONCURRENCY';
      insert into public.employee_profiles(
        public_id,tenant_id,organization_id,organization_member_id,employee_no,display_name,
        department_id,job_title,employment_type,employment_status,manager_employee_id,manager_source
      )
      select 'e1100000-0000-4000-8000-000000000001',member.tenant_id,member.organization_id,
        member.id,'EC-APPLICANT','expense-concurrency-applicant',department.id,'Employee',
        'full_time','active',manager.id,'manual'
      from public.organization_members member
      join public.departments department on department.tenant_id=member.tenant_id
        and department.organization_id=member.organization_id and department.code='EXP-CONCURRENCY'
      join public.employee_profiles manager on manager.tenant_id=member.tenant_id
        and manager.organization_id=member.organization_id
        and manager.display_name='expense-concurrency-manager'
      where member.user_id='e1000000-0000-4000-8000-000000000001';
      insert into public.external_identities(
        tenant_id,organization_id,organization_member_id,identity_provider_id,
        provider_subject,provider_tenant_key,auth_user_id,status
      )
      select member.tenant_id,member.organization_id,member.id,provider.id,member.user_id::text,
        provider.provider_tenant_key,member.user_id,'active'
      from public.organization_members member
      join public.identity_providers provider on provider.tenant_id=member.tenant_id
        and provider.provider_code='expense-concurrency'
      where member.user_id in (
        'e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002',
        'e1000000-0000-4000-8000-000000000003'
      );
      insert into public.member_roles(tenant_id,member_id,role_id)
      select member.tenant_id,member.id,role.id
      from public.organization_members member
      join public.roles role on role.tenant_id=member.tenant_id and role.organization_id is null
        and role.code=case member.user_id
          when 'e1000000-0000-4000-8000-000000000002'::uuid then 'supervisor'
          when 'e1000000-0000-4000-8000-000000000003'::uuid then 'finance'
          else 'employee' end
      where member.user_id in (
        'e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002',
        'e1000000-0000-4000-8000-000000000003'
      );
      insert into public.projects(
        public_id,tenant_id,organization_id,code,name,category,description,
        owner_member_id,created_by_member_id,updated_by_member_id,budget_amount,
        status,health,priority,start_date,due_date,progress,version
      )
      select 'e1200000-0000-4000-8000-000000000001',organization.tenant_id,organization.id,
        'EXP-CONCURRENCY','Expense concurrency project','Delivery','Concurrency fixture',
        member.id,member.id,member.id,0,'active','on_track','medium',current_date,current_date+30,0,1
      from public.organizations organization
      join public.organization_members member on member.tenant_id=organization.tenant_id
        and member.organization_id=organization.id
        and member.user_id='e1000000-0000-4000-8000-000000000001'
      where organization.slug='expense-concurrency-org';
      insert into public.project_members(
        tenant_id,organization_id,project_id,member_id,role,allocation_percent,
        created_by_member_id,updated_by_member_id,version
      )
      select project.tenant_id,project.organization_id,project.id,project.owner_member_id,
        'owner',100,project.owner_member_id,project.owner_member_id,1
      from public.projects project where project.public_id='e1200000-0000-4000-8000-000000000001';
      commit;
    $setup$;
  execute format('select id from %I.dblink($1,$2) as remote(id bigint)',v_extension_schema)
    into v_fixture_tenant using 'expense_concurrency_setup',
      'select id from public.tenants where slug=''expense-concurrency''';

  foreach v_connection in array array['expense_concurrency_a','expense_concurrency_b'] loop
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using v_connection,'begin';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using v_connection,'set local role authenticated';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using v_connection,
        'set local "request.jwt.claim.sub" = ''e1000000-0000-4000-8000-000000000001''';
  end loop;
  execute format('select pid from %I.dblink($1,$2) as remote(pid integer)',v_extension_schema)
    into v_worker_a_pid using 'expense_concurrency_a','select pg_backend_pid()';
  execute format('select pid from %I.dblink($1,$2) as remote(pid integer)',v_extension_schema)
    into v_worker_b_pid using 'expense_concurrency_b','select pg_backend_pid()';
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup','begin';
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup',$lock_project$
      do $remote$ begin perform 1 from public.projects
      where public_id='e1200000-0000-4000-8000-000000000001' for update; end $remote$;
    $lock_project$;
  execute format('select %I.dblink_send_query($1,$2)',v_extension_schema)
    into v_integer using 'expense_concurrency_a',$create_a$
      select public.create_current_expense(
        'e1200000-0000-4000-8000-000000000001','other','10.00','2026-08-28',
        '并发幂等费用','{}'::uuid[],'e1500000-0000-4000-8000-000000000001',
        'e1600000-0000-4000-8000-000000000001')
    $create_a$;
  v_wait_count:=0; v_waiting_a:=false;
  loop
    select exists(select 1 from pg_stat_activity where pid=v_worker_a_pid and wait_event_type='Lock')
      into v_waiting_a;
    exit when v_waiting_a or v_wait_count>=200;
    v_wait_count:=v_wait_count+1; perform pg_sleep(0.005);
  end loop;
  execute format('select %I.dblink_send_query($1,$2)',v_extension_schema)
    into v_integer using 'expense_concurrency_b',$create_b$
      select public.create_current_expense(
        'e1200000-0000-4000-8000-000000000001','other','10.00','2026-08-28',
        '并发幂等费用','{}'::uuid[],'e1500000-0000-4000-8000-000000000001',
        'e1600000-0000-4000-8000-000000000002')
    $create_b$;
  v_wait_count:=0; v_waiting_b:=false;
  loop
    select exists(select 1 from pg_stat_activity where pid=v_worker_b_pid and wait_event_type='Lock')
      into v_waiting_b;
    exit when v_waiting_b or v_wait_count>=200;
    v_wait_count:=v_wait_count+1; perform pg_sleep(0.005);
  end loop;
  if v_waiting_a and v_waiting_b then
    perform set_config('test.expense.concurrent.same_key_wait','true',true);
  end if;
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup','commit';
  v_wait_count:=0;
  loop
    execute format('select %I.dblink_is_busy($1)',v_extension_schema)
      into v_busy_a using 'expense_concurrency_a';
    execute format('select %I.dblink_is_busy($1)',v_extension_schema)
      into v_busy_b using 'expense_concurrency_b';
    exit when v_busy_a=0 or v_busy_b=0 or v_wait_count>=300;
    v_wait_count:=v_wait_count+1; perform pg_sleep(0.01);
  end loop;
  if v_busy_a=0 then
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_a using 'expense_concurrency_a';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'expense_concurrency_a','commit';
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_b using 'expense_concurrency_b';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'expense_concurrency_b','commit';
  elsif v_busy_b=0 then
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_b using 'expense_concurrency_b';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'expense_concurrency_b','commit';
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_a using 'expense_concurrency_a';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'expense_concurrency_a','commit';
  else
    raise exception 'same-key workers did not produce a winner';
  end if;
  v_expense_id:=(v_result_a->>'id')::uuid;
  execute format('select count from %I.dblink($1,$2) as remote(count bigint)',v_extension_schema)
    into v_count using 'expense_concurrency_setup',format(
      'select count(*) from public.expense_reports where public_id=%L',v_expense_id
    );
  if v_result_a=v_result_b and v_result_a->>'outcome'='success' and v_count=1 then
    perform set_config('test.expense.concurrent.same_key_one','true',true);
  end if;

  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup','begin';
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup','set local role authenticated';
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup',
      'set local "request.jwt.claim.sub" = ''e1000000-0000-4000-8000-000000000001''';
  execute format('select result from %I.dblink($1,$2) as remote(result jsonb)',v_extension_schema)
    into v_submit using 'expense_concurrency_setup',format(
      'select public.submit_current_expense(%L,1,%L,%L)',v_expense_id,
      'e1500000-0000-4000-8000-000000000002'::uuid,
      'e1600000-0000-4000-8000-000000000003'::uuid
    );
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup','commit';
  v_approval_id:=(v_submit->'entity'->>'approvalId')::uuid;

  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_a','begin';
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_a','set local role authenticated';
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_a',
      'set local "request.jwt.claim.sub" = ''e1000000-0000-4000-8000-000000000001''';
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_b','begin';
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_b','set local role authenticated';
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_b',
      'set local "request.jwt.claim.sub" = ''e1000000-0000-4000-8000-000000000002''';
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup','begin';
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup',format(
      'do $remote$ begin perform 1 from public.approvals where public_id=%L for update; end $remote$',
      v_approval_id
    );
  execute format('select %I.dblink_send_query($1,$2)',v_extension_schema)
    into v_integer using 'expense_concurrency_a',format(
      'select public.cancel_current_expense(%L,2,%L,%L,%L)',v_expense_id,'并发取消',
      'e1500000-0000-4000-8000-000000000003'::uuid,
      'e1600000-0000-4000-8000-000000000004'::uuid
    );
  execute format('select %I.dblink_send_query($1,$2)',v_extension_schema)
    into v_integer using 'expense_concurrency_b',format(
      'select public.act_on_current_approval(%L,%L,1,null,%L)',v_approval_id,'approve',
      'e1700000-0000-4000-8000-000000000001'::uuid
    );
  v_wait_count:=0; v_waiting_a:=false; v_waiting_b:=false;
  loop
    select exists(select 1 from pg_stat_activity where pid=v_worker_a_pid and wait_event_type='Lock')
      into v_waiting_a;
    select exists(select 1 from pg_stat_activity where pid=v_worker_b_pid and wait_event_type='Lock')
      into v_waiting_b;
    exit when (v_waiting_a and v_waiting_b) or v_wait_count>=200;
    v_wait_count:=v_wait_count+1; perform pg_sleep(0.005);
  end loop;
  if v_waiting_a and v_waiting_b then
    perform set_config('test.expense.concurrent.race_wait','true',true);
  end if;
  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup','commit';
  v_wait_count:=0;
  loop
    execute format('select %I.dblink_is_busy($1)',v_extension_schema)
      into v_busy_a using 'expense_concurrency_a';
    execute format('select %I.dblink_is_busy($1)',v_extension_schema)
      into v_busy_b using 'expense_concurrency_b';
    exit when v_busy_a=0 or v_busy_b=0 or v_wait_count>=300;
    v_wait_count:=v_wait_count+1; perform pg_sleep(0.01);
  end loop;
  if v_busy_a=0 then
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_a using 'expense_concurrency_a';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'expense_concurrency_a','commit';
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_b using 'expense_concurrency_b';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'expense_concurrency_b','commit';
  elsif v_busy_b=0 then
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_b using 'expense_concurrency_b';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'expense_concurrency_b','commit';
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_a using 'expense_concurrency_a';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'expense_concurrency_a','commit';
  else
    raise exception 'approval cancellation workers did not produce a winner';
  end if;
  execute format('select result from %I.dblink($1,$2) as remote(result jsonb)',v_extension_schema)
    into v_final using 'expense_concurrency_setup',format(
      $query$select jsonb_build_object(
        'expenseStatus',expense.status,'expenseVersion',expense.version,
        'approvalStatus',approval.status,'approvalVersion',approval.version
      ) from public.expense_reports expense join public.approvals approval
        on approval.id=expense.approval_id where expense.public_id=%L$query$,v_expense_id
    );
  if (
    (v_result_a->>'outcome'='success' and v_result_b->>'error'='conflict'
      and v_final->>'expenseStatus'='cancelled' and (v_final->>'expenseVersion')::bigint=3
      and v_final->>'approvalStatus'='cancelled')
    or (v_result_b->>'outcome'='success' and v_result_a->>'error'='conflict'
      and v_final->>'expenseStatus'='submitted' and (v_final->>'expenseVersion')::bigint=3
      and v_final->>'approvalStatus'='pending' and (v_final->>'approvalVersion')::bigint=2)
  ) then
    perform set_config('test.expense.concurrent.race_one','true',true);
  end if;

  execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
    into v_status using 'expense_concurrency_setup',v_cleanup_sql;
  execute format('select count from %I.dblink($1,$2) as remote(count bigint)',v_extension_schema)
    into v_count using 'expense_concurrency_setup',format($residue$
      select coalesce(sum(residue.count),0)::bigint from (
        select count(*) from public.audit_logs where tenant_id=%1$L
        union all select count(*) from public.expense_receipts where tenant_id=%1$L
        union all select count(*) from public.expense_command_idempotency where tenant_id=%1$L
        union all select count(*) from public.approval_action_idempotency where tenant_id=%1$L
        union all select count(*) from public.approval_command_idempotency where tenant_id=%1$L
        union all select count(*) from public.expense_reports where tenant_id=%1$L
        union all select count(*) from public.approval_actions where tenant_id=%1$L
        union all select count(*) from public.approval_steps where tenant_id=%1$L
        union all select count(*) from public.approvals where tenant_id=%1$L
        union all select count(*) from public.approval_templates where tenant_id=%1$L
        union all select count(*) from public.project_members where tenant_id=%1$L
        union all select count(*) from public.projects where tenant_id=%1$L
        union all select count(*) from public.member_roles where tenant_id=%1$L
        union all select count(*) from public.role_permissions where tenant_id=%1$L
        union all select count(*) from public.roles where tenant_id=%1$L
        union all select count(*) from public.external_identities where tenant_id=%1$L
        union all select count(*) from public.employee_private_profiles where tenant_id=%1$L
        union all select count(*) from public.employee_profiles where tenant_id=%1$L
        union all select count(*) from public.organization_members where tenant_id=%1$L
        union all select count(*) from public.identity_providers where tenant_id=%1$L
        union all select count(*) from public.departments where tenant_id=%1$L
        union all select count(*) from public.organizations where tenant_id=%1$L
        union all select count(*) from public.tenants where id=%1$L
        union all select count(*) from auth.users where id in (
          'e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002',
          'e1000000-0000-4000-8000-000000000003'
        )
      ) residue(count)
    $residue$,v_fixture_tenant);
  if v_count=0 then
    perform set_config('test.expense.concurrent.cleaned','true',true);
  end if;
  foreach v_connection in array array[
    'expense_concurrency_setup','expense_concurrency_a','expense_concurrency_b'
  ] loop
    execute format('select %I.dblink_disconnect($1)',v_extension_schema)
      into v_status using v_connection;
  end loop;
exception when others then
  foreach v_connection in array array['expense_concurrency_a','expense_concurrency_b'] loop
    begin
      execute format('select %I.dblink_cancel_query($1)',v_extension_schema)
        into v_status using v_connection;
    exception when others then null; end;
    begin
      execute format('select result from %I.dblink_get_result($1) as remote(result text)',v_extension_schema)
        into v_drain using v_connection;
    exception when others then null; end;
    begin
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'rollback';
    exception when others then null; end;
  end loop;
  begin
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'expense_concurrency_setup','rollback';
  exception when others then null; end;
  begin
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'expense_concurrency_setup',v_cleanup_sql;
  exception when others then
    begin
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using 'expense_concurrency_setup','rollback';
    exception when others then null; end;
  end;
  foreach v_connection in array array[
    'expense_concurrency_setup','expense_concurrency_a','expense_concurrency_b'
  ] loop
    begin
      execute format('select %I.dblink_disconnect($1)',v_extension_schema)
        into v_status using v_connection;
    exception when others then null; end;
  end loop;
  raise;
end;
$expense_workflow_concurrency$;

select ok(true,case when current_setting('test.expense.concurrent.available')='true'
  then 'dblink expense concurrency harness completed'
  else 'expense concurrency harness # SKIP dblink extension or local connection unavailable' end);
select ok(
  current_setting('test.expense.concurrent.available')<>'true'
    or current_setting('test.expense.concurrent.same_key_wait')='true',
  case when current_setting('test.expense.concurrent.available')='true'
    then 'same-key worker waits behind the first durable expense claim'
    else 'same-key wait proof # SKIP dblink unavailable' end
);
select ok(
  current_setting('test.expense.concurrent.available')<>'true'
    or current_setting('test.expense.concurrent.same_key_one')='true',
  case when current_setting('test.expense.concurrent.available')='true'
    then 'concurrent same-key creates return one canonical expense'
    else 'same-key canonical expense proof # SKIP dblink unavailable' end
);
select ok(
  current_setting('test.expense.concurrent.available')<>'true'
    or current_setting('test.expense.concurrent.race_wait')='true',
  case when current_setting('test.expense.concurrent.available')='true'
    then 'approval and cancellation workers both reach the shared approval lock'
    else 'approval cancellation wait proof # SKIP dblink unavailable' end
);
select ok(
  current_setting('test.expense.concurrent.available')<>'true'
    or current_setting('test.expense.concurrent.race_one')='true',
  case when current_setting('test.expense.concurrent.available')='true'
    then 'approval versus cancellation race has no deadlock and one legal winner'
    else 'approval cancellation winner proof # SKIP dblink unavailable' end
);
select ok(
  current_setting('test.expense.concurrent.available')<>'true'
    or current_setting('test.expense.concurrent.cleaned')='true',
  case when current_setting('test.expense.concurrent.available')='true'
    then 'expense concurrency fixture is removed after verification'
    else 'expense concurrency cleanup # SKIP dblink unavailable' end
);

select * from finish();
rollback;
