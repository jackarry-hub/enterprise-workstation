begin;
select plan(4);

select set_config('test.project.execution.concurrent.available','false',true);
select set_config('test.project.execution.concurrent.same_key_wait','false',true);
select set_config('test.project.execution.concurrent.same_key_one','false',true);
select set_config('test.project.execution.concurrent.dag_one','false',true);

do $project_execution_concurrency$
declare
  v_extension_schema name;
  v_status text;
  v_integer integer;
  v_worker_a_pid integer;
  v_worker_b_pid integer;
  v_busy_a integer;
  v_busy_b integer;
  v_wait_count integer;
  v_waiting boolean;
  v_waiting_a boolean;
  v_waiting_b boolean;
  v_result_a jsonb;
  v_result_b jsonb;
  v_count bigint;
  v_connection text;
  v_drain text;
begin
  begin
    select namespace.nspname into v_extension_schema
    from pg_extension extension
    join pg_namespace namespace on namespace.oid=extension.extnamespace
    where extension.extname='dblink';
    if not found then
      if not exists(select 1 from pg_available_extensions where name='dblink') then return; end if;
      begin
        execute 'create extension dblink with schema extensions';
      exception when undefined_schema then
        execute 'create extension dblink';
      end;
      select namespace.nspname into strict v_extension_schema
      from pg_extension extension
      join pg_namespace namespace on namespace.oid=extension.extnamespace
      where extension.extname='dblink';
    end if;
    foreach v_connection in array array['execution_concurrency_setup','execution_concurrency_a','execution_concurrency_b'] loop
      execute format('select %I.dblink_connect($1,$2)',v_extension_schema)
        into v_status using v_connection,'dbname='||current_database();
    end loop;
  exception when others then
    foreach v_connection in array array['execution_concurrency_setup','execution_concurrency_a','execution_concurrency_b'] loop
      begin
        execute format('select %I.dblink_disconnect($1)',v_extension_schema)
          into v_status using v_connection;
      exception when others then null;
      end;
    end loop;
    return;
  end;

  perform set_config('test.project.execution.concurrent.available','true',true);
  begin
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'execution_concurrency_setup','set statement_timeout = ''15s''';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'execution_concurrency_setup',$setup$
        begin;
        set local session_replication_role = replica;
        delete from public.audit_logs where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        set local session_replication_role = origin;
        delete from public.project_execution_command_idempotency where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.task_dependencies where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.task_comments where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.daily_reports where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.project_activities where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.project_risks where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.milestones where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.tasks where project_id in (
          select project.id from public.projects project join public.tenants tenant on tenant.id=project.tenant_id
          where tenant.slug='project-execution-concurrency'
        );
        delete from public.project_members where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.projects where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.external_identities where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.employee_profiles where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.organization_members where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.identity_providers where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.organizations where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.tenants where slug='project-execution-concurrency';
        delete from auth.users where id='8c000000-0000-4000-8000-000000000001';

        insert into public.tenants(name,slug,status)
        values('Project execution concurrency','project-execution-concurrency','active');
        insert into public.organizations(tenant_id,name,slug)
        select id,'Project execution concurrency','project-execution-concurrency-org'
        from public.tenants where slug='project-execution-concurrency';
        insert into public.identity_providers(
          tenant_id,provider_code,auth_provider,provider_tenant_key,display_name,status
        )
        select id,'executionconcurrency','custom:executionconcurrency','execution-concurrency-key',
               'Execution concurrency identity','active'
        from public.tenants where slug='project-execution-concurrency';
        insert into auth.users(
          instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
          raw_app_meta_data,raw_user_meta_data,created_at,updated_at
        ) values (
          '00000000-0000-0000-0000-000000000000','8c000000-0000-4000-8000-000000000001',
          'authenticated','authenticated','execution-concurrency@example.test',
          crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()
        );
        insert into public.organization_members(tenant_id,organization_id,user_id,status)
        select tenant.id,organization.id,'8c000000-0000-4000-8000-000000000001','active'
        from public.tenants tenant
        join public.organizations organization on organization.tenant_id=tenant.id
        where tenant.slug='project-execution-concurrency';
        insert into public.employee_profiles(
          public_id,tenant_id,organization_id,organization_member_id,employee_no,
          display_name,job_title,employment_status,skills
        )
        select '8c100000-0000-4000-8000-000000000001',member.tenant_id,member.organization_id,
               member.id,'EXECUTION-CONCURRENCY','Concurrency owner','Project owner','active','{}'::text[]
        from public.organization_members member
        where member.user_id='8c000000-0000-4000-8000-000000000001';
        insert into public.external_identities(
          tenant_id,organization_id,organization_member_id,identity_provider_id,
          provider_subject,provider_tenant_key,auth_user_id,status
        )
        select member.tenant_id,member.organization_id,member.id,provider.id,
               member.user_id::text,provider.provider_tenant_key,member.user_id,'active'
        from public.organization_members member
        join public.identity_providers provider on provider.tenant_id=member.tenant_id
        where member.user_id='8c000000-0000-4000-8000-000000000001'
          and provider.provider_code='executionconcurrency';
        insert into public.projects(
          public_id,tenant_id,organization_id,code,name,category,description,
          owner_member_id,created_by_member_id,updated_by_member_id,budget_amount,
          status,health,priority,start_date,due_date,progress,version
        )
        select '8c200000-0000-4000-8000-000000000001',tenant.id,organization.id,
               'QXY-CONCURRENCY','Execution concurrency project','Delivery','Concurrency proof',
               member.id,member.id,member.id,0,'active','on_track','medium',
               '2026-09-01','2026-12-31',0,1
        from public.tenants tenant
        join public.organizations organization on organization.tenant_id=tenant.id
        join public.organization_members member on member.tenant_id=tenant.id and member.organization_id=organization.id
        where tenant.slug='project-execution-concurrency';
        insert into public.project_members(
          tenant_id,organization_id,project_id,member_id,role,allocation_percent,
          created_by_member_id,updated_by_member_id,version
        )
        select project.tenant_id,project.organization_id,project.id,project.owner_member_id,
               'owner',100,project.owner_member_id,project.owner_member_id,1
        from public.projects project where project.public_id='8c200000-0000-4000-8000-000000000001';
        insert into public.tasks(
          public_id,organization_id,project_id,reporter_member_id,title,description,
          status,priority,progress,sort_order
        )
        select seed.public_id,project.organization_id,project.id,project.owner_member_id,
               seed.title,'Dependency concurrency proof','todo','medium',0,seed.sort_order
        from public.projects project
        cross join (values
          ('8c300000-0000-4000-8000-000000000001'::uuid,'Concurrent task A',1),
          ('8c300000-0000-4000-8000-000000000002'::uuid,'Concurrent task B',2)
        ) seed(public_id,title,sort_order)
        where project.public_id='8c200000-0000-4000-8000-000000000001';
        commit;
      $setup$;

    foreach v_connection in array array['execution_concurrency_a','execution_concurrency_b'] loop
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'set statement_timeout = ''15s''';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'begin';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'set local role authenticated';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'set local "request.jwt.claim.sub" = ''8c000000-0000-4000-8000-000000000001''';
    end loop;
    execute format('select pid from %I.dblink($1,$2) as remote(pid integer)',v_extension_schema)
      into v_worker_a_pid using 'execution_concurrency_a','select pg_backend_pid()';
    execute format('select pid from %I.dblink($1,$2) as remote(pid integer)',v_extension_schema)
      into v_worker_b_pid using 'execution_concurrency_b','select pg_backend_pid()';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'execution_concurrency_setup','begin';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'execution_concurrency_setup',$lock_project$
        do $remote$ begin
          perform 1 from public.projects
          where public_id='8c200000-0000-4000-8000-000000000001'
          for update;
        end $remote$;
      $lock_project$;

    execute format('select %I.dblink_send_query($1,$2)',v_extension_schema)
      into v_integer using 'execution_concurrency_a',$milestone_a$
        select public.create_current_project_milestone(
          '8c200000-0000-4000-8000-000000000001','Concurrent milestone','One canonical row',
          '8c100000-0000-4000-8000-000000000001','2026-09-01','2026-09-30',0,
          'Concurrent milestone','8c400000-0000-4000-8000-000000000001','8c400000-0000-4000-8000-000000000002'
        )
      $milestone_a$;
    v_wait_count:=0; v_waiting:=false;
    loop
      select exists(
        select 1 from pg_stat_activity activity
        where activity.pid=v_worker_a_pid and activity.wait_event_type='Lock'
      ) into v_waiting;
      exit when v_waiting or v_wait_count>=200;
      v_wait_count:=v_wait_count+1; perform pg_sleep(0.005);
    end loop;
    if not v_waiting then
      raise exception 'milestone worker A did not reach the project lock while holding the idempotency claim';
    end if;
    execute format('select %I.dblink_send_query($1,$2)',v_extension_schema)
      into v_integer using 'execution_concurrency_b',$milestone_b$
        select public.create_current_project_milestone(
          '8c200000-0000-4000-8000-000000000001','Concurrent milestone','One canonical row',
          '8c100000-0000-4000-8000-000000000001','2026-09-01','2026-09-30',0,
          'Concurrent milestone','8c400000-0000-4000-8000-000000000003','8c400000-0000-4000-8000-000000000002'
        )
      $milestone_b$;
    v_wait_count:=0; v_waiting:=false;
    loop
      execute format('select %I.dblink_is_busy($1)',v_extension_schema)
        into v_busy_b using 'execution_concurrency_b';
      select exists(
        select 1 from pg_stat_activity activity
        where activity.pid=v_worker_b_pid and activity.wait_event_type='Lock'
      ) into v_waiting;
      exit when v_waiting or v_busy_b=0 or v_wait_count>=200;
      v_wait_count:=v_wait_count+1; perform pg_sleep(0.005);
    end loop;
    if not v_waiting then
      raise exception 'milestone worker B did not wait on worker A idempotency claim';
    end if;
    perform set_config('test.project.execution.concurrent.same_key_wait','true',true);
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'execution_concurrency_setup','commit';
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_a using 'execution_concurrency_a';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'execution_concurrency_a','commit';
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_b using 'execution_concurrency_b';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'execution_concurrency_b','commit';
    execute format('select count from %I.dblink($1,$2) as remote(count bigint)',v_extension_schema)
      into v_count using 'execution_concurrency_setup',$milestone_count$
        select count(*) from public.milestones milestone
        join public.projects project on project.id=milestone.project_id
        where project.public_id='8c200000-0000-4000-8000-000000000001'
          and milestone.name='Concurrent milestone'
      $milestone_count$;
    if v_result_a->>'outcome'='success' and v_result_b->>'outcome'='success'
       and v_result_a->>'id'=v_result_b->>'id' and v_count=1 then
      perform set_config('test.project.execution.concurrent.same_key_one','true',true);
    end if;

    foreach v_connection in array array['execution_concurrency_a','execution_concurrency_b'] loop
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'begin';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'set local role authenticated';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'set local "request.jwt.claim.sub" = ''8c000000-0000-4000-8000-000000000001''';
    end loop;
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'execution_concurrency_setup','begin';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'execution_concurrency_setup',$lock_project_again$
        do $remote$ begin
          perform 1 from public.projects
          where public_id='8c200000-0000-4000-8000-000000000001'
          for update;
        end $remote$;
      $lock_project_again$;
    execute format('select %I.dblink_send_query($1,$2)',v_extension_schema)
      into v_integer using 'execution_concurrency_a',$dependency_a$
        select public.create_current_task_dependency(
          '8c300000-0000-4000-8000-000000000001','8c300000-0000-4000-8000-000000000002',
          'A depends on B','8c500000-0000-4000-8000-000000000001','8c500000-0000-4000-8000-000000000002'
        )
      $dependency_a$;
    execute format('select %I.dblink_send_query($1,$2)',v_extension_schema)
      into v_integer using 'execution_concurrency_b',$dependency_b$
        select public.create_current_task_dependency(
          '8c300000-0000-4000-8000-000000000002','8c300000-0000-4000-8000-000000000001',
          'B depends on A','8c500000-0000-4000-8000-000000000003','8c500000-0000-4000-8000-000000000004'
        )
      $dependency_b$;
    v_wait_count:=0; v_waiting_a:=false; v_waiting_b:=false;
    loop
      select exists(
        select 1 from pg_stat_activity activity
        where activity.pid=v_worker_a_pid and activity.wait_event_type='Lock'
      ) into v_waiting_a;
      select exists(
        select 1 from pg_stat_activity activity
        where activity.pid=v_worker_b_pid and activity.wait_event_type='Lock'
      ) into v_waiting_b;
      exit when (v_waiting_a and v_waiting_b) or v_wait_count>=200;
      v_wait_count:=v_wait_count+1; perform pg_sleep(0.005);
    end loop;
    if not (v_waiting_a and v_waiting_b) then
      raise exception 'both dependency workers did not reach the project serialization lock';
    end if;
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'execution_concurrency_setup','commit';
    v_wait_count:=0;
    loop
      execute format('select %I.dblink_is_busy($1)',v_extension_schema)
        into v_busy_a using 'execution_concurrency_a';
      execute format('select %I.dblink_is_busy($1)',v_extension_schema)
        into v_busy_b using 'execution_concurrency_b';
      exit when v_busy_a=0 or v_busy_b=0 or v_wait_count>=300;
      v_wait_count:=v_wait_count+1; perform pg_sleep(0.01);
    end loop;
    if v_busy_a=0 then
      execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
        into v_result_a using 'execution_concurrency_a';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using 'execution_concurrency_a','commit';
      execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
        into v_result_b using 'execution_concurrency_b';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using 'execution_concurrency_b','commit';
    else
      execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
        into v_result_b using 'execution_concurrency_b';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using 'execution_concurrency_b','commit';
      execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
        into v_result_a using 'execution_concurrency_a';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using 'execution_concurrency_a','commit';
    end if;
    execute format('select count from %I.dblink($1,$2) as remote(count bigint)',v_extension_schema)
      into v_count using 'execution_concurrency_setup',$dependency_count$
        select count(*) from public.task_dependencies dependency
        join public.projects project on project.id=dependency.project_id
        where project.public_id='8c200000-0000-4000-8000-000000000001'
      $dependency_count$;
    if v_count=1 and (
      (v_result_a->>'outcome'='success' and v_result_b->>'error'='task_dependency_cycle')
      or (v_result_b->>'outcome'='success' and v_result_a->>'error'='task_dependency_cycle')
    ) then
      perform set_config('test.project.execution.concurrent.dag_one','true',true);
    end if;

    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'execution_concurrency_setup',$cleanup$
        begin;
        set local session_replication_role = replica;
        delete from public.audit_logs where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        set local session_replication_role = origin;
        delete from public.project_execution_command_idempotency where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.task_dependencies where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.task_comments where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.daily_reports where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.project_activities where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.project_risks where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.milestones where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.tasks where project_id in (select id from public.projects where tenant_id in (select id from public.tenants where slug='project-execution-concurrency'));
        delete from public.project_members where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.projects where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.external_identities where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.employee_profiles where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.organization_members where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.identity_providers where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.organizations where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
        delete from public.tenants where slug='project-execution-concurrency';
        delete from auth.users where id='8c000000-0000-4000-8000-000000000001';
        commit;
      $cleanup$;
    foreach v_connection in array array['execution_concurrency_setup','execution_concurrency_a','execution_concurrency_b'] loop
      execute format('select %I.dblink_disconnect($1)',v_extension_schema)
        into v_status using v_connection;
    end loop;
  exception when others then
    foreach v_connection in array array['execution_concurrency_a','execution_concurrency_b'] loop
      begin
        execute format('select %I.dblink_cancel_query($1)',v_extension_schema)
          into v_status using v_connection;
      exception when others then null;
      end;
      begin
        execute format('select result from %I.dblink_get_result($1) as remote(result text)',v_extension_schema)
          into v_drain using v_connection;
      exception when others then null;
      end;
      begin
        execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
          into v_status using v_connection,'rollback';
      exception when others then null;
      end;
    end loop;
    begin
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using 'execution_concurrency_setup','rollback';
    exception when others then null;
    end;
    begin
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using 'execution_concurrency_setup',$cleanup_after_failure$
          begin;
          set local session_replication_role = replica;
          delete from public.audit_logs where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          set local session_replication_role = origin;
          delete from public.project_execution_command_idempotency where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.task_dependencies where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.task_comments where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.daily_reports where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.project_activities where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.project_risks where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.milestones where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.tasks where project_id in (select id from public.projects where tenant_id in (select id from public.tenants where slug='project-execution-concurrency'));
          delete from public.project_members where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.projects where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.external_identities where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.employee_profiles where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.organization_members where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.identity_providers where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.organizations where tenant_id in (select id from public.tenants where slug='project-execution-concurrency');
          delete from public.tenants where slug='project-execution-concurrency';
          delete from auth.users where id='8c000000-0000-4000-8000-000000000001';
          commit;
        $cleanup_after_failure$;
    exception when others then
      begin
        execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
          into v_status using 'execution_concurrency_setup','rollback';
      exception when others then null;
      end;
    end;
    foreach v_connection in array array['execution_concurrency_setup','execution_concurrency_a','execution_concurrency_b'] loop
      begin
        execute format('select %I.dblink_disconnect($1)',v_extension_schema)
          into v_status using v_connection;
      exception when others then null;
      end;
    end loop;
    raise;
  end;
end;
$project_execution_concurrency$;

select case when current_setting('test.project.execution.concurrent.available')='true'
  then ok(true,'dblink execution concurrency harness completed')
  else ok(true,'execution concurrency harness # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.project.execution.concurrent.available')='true'
  then ok(current_setting('test.project.execution.concurrent.same_key_wait')='true','second same-key execution command waits on the first transaction')
  else ok(true,'same-key execution wait proof # SKIP dblink unavailable')
end;
select case when current_setting('test.project.execution.concurrent.available')='true'
  then ok(current_setting('test.project.execution.concurrent.same_key_one')='true','concurrent same-key milestone commands return one canonical row')
  else ok(true,'same-key canonical milestone proof # SKIP dblink unavailable')
end;
select case when current_setting('test.project.execution.concurrent.available')='true'
  then ok(current_setting('test.project.execution.concurrent.dag_one')='true','opposing concurrent dependencies preserve one acyclic edge')
  else ok(true,'concurrent dependency DAG proof # SKIP dblink unavailable')
end;

select * from finish();
rollback;
