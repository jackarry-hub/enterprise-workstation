begin;
select plan(2);

-- Build and remove a committed, isolated fixture through dblink so two real
-- database connections can race the same command key without inheriting locks
-- from the ordinary lifecycle test transaction.
select set_config('test.project.lifecycle.dblink_available','false',true);
select set_config('test.project.lifecycle.concurrent_wait','false',true);
select set_config('test.project.lifecycle.concurrent_same','false',true);
do $project_concurrency$
declare
  v_extension_schema name;
  v_status text;
  v_integer integer;
  v_worker_a_pid integer;
  v_worker_b_pid integer;
  v_wait_count integer := 0;
  v_waiting boolean := false;
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
      if not exists(select 1 from pg_available_extensions where name='dblink') then
        return;
      end if;
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
    execute format('select %I.dblink_connect($1,$2)',v_extension_schema)
      into v_status using 'project_concurrency_setup','dbname='||current_database();
    execute format('select %I.dblink_connect($1,$2)',v_extension_schema)
      into v_status using 'project_concurrency_a','dbname='||current_database();
    execute format('select %I.dblink_connect($1,$2)',v_extension_schema)
      into v_status using 'project_concurrency_b','dbname='||current_database();
  exception when others then
    foreach v_connection in array array['project_concurrency_setup','project_concurrency_a','project_concurrency_b'] loop
      begin
        execute format('select %I.dblink_disconnect($1)',v_extension_schema)
          into v_status using v_connection;
      exception when others then null;
      end;
    end loop;
    return;
  end;

  perform set_config('test.project.lifecycle.dblink_available','true',true);
  begin
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'project_concurrency_setup','set statement_timeout = ''10s''';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'project_concurrency_setup',$setup$
        begin;
        set local session_replication_role = replica;
        delete from public.audit_logs where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        set local session_replication_role = origin;
        delete from public.project_command_idempotency where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.tasks where project_id in (
          select project.id from public.projects project join public.tenants tenant on tenant.id=project.tenant_id where tenant.slug='project-concurrency-proof'
        );
        delete from public.project_members where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.projects where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.member_roles where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.role_permissions where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.external_identities where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.employee_profiles where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.roles where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.organization_members where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.identity_providers where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.organizations where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.tenants where slug='project-concurrency-proof';
        delete from auth.users where id in ('86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000002');
        insert into public.tenants(name,slug,status) values('Project concurrency proof','project-concurrency-proof','active');
        insert into public.organizations(tenant_id,name,slug)
        select id,'Project concurrency organization','project-concurrency-organization'
        from public.tenants where slug='project-concurrency-proof';
        insert into public.identity_providers(tenant_id,provider_code,auth_provider,provider_tenant_key,display_name,status)
        select id,'projectconcurrency','custom:projectconcurrency','project-concurrency-key','Project concurrency identity','active'
        from public.tenants where slug='project-concurrency-proof';
        insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
          ('00000000-0000-0000-0000-000000000000','86000000-0000-4000-8000-000000000001','authenticated','authenticated','project-concurrency-manager@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
          ('00000000-0000-0000-0000-000000000000','86000000-0000-4000-8000-000000000002','authenticated','authenticated','project-concurrency-owner@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());
        insert into public.organization_members(tenant_id,organization_id,user_id,status)
        select tenant.id,organization.id,seed.user_id,'active'
        from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id
        cross join (values
          ('86000000-0000-4000-8000-000000000001'::uuid),
          ('86000000-0000-4000-8000-000000000002'::uuid)
        ) seed(user_id)
        where tenant.slug='project-concurrency-proof';
        insert into public.employee_profiles(
          public_id,tenant_id,organization_id,organization_member_id,employee_no,display_name,
          job_title,employment_status,skills
        )
        select seed.public_id,member.tenant_id,member.organization_id,member.id,
               'CONCURRENT-'||member.id,seed.display_name,'Project delivery','active','{}'::text[]
        from (values
          ('86000000-0000-4000-8000-000000000001'::uuid,'86100000-0000-4000-8000-000000000001'::uuid,'Concurrent manager'),
          ('86000000-0000-4000-8000-000000000002'::uuid,'86100000-0000-4000-8000-000000000002'::uuid,'Concurrent owner')
        ) seed(user_id,public_id,display_name)
        join public.organization_members member on member.user_id=seed.user_id;
        insert into public.external_identities(
          tenant_id,organization_id,organization_member_id,identity_provider_id,
          provider_subject,provider_tenant_key,auth_user_id,status
        )
        select member.tenant_id,member.organization_id,member.id,provider.id,member.user_id::text,
               provider.provider_tenant_key,member.user_id,'active'
        from public.organization_members member join public.identity_providers provider
          on provider.tenant_id=member.tenant_id and provider.provider_code='projectconcurrency'
        where member.user_id in ('86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000002');
        insert into public.roles(tenant_id,organization_id,code,name,description,is_system,is_enabled)
        select tenant.id,organization.id,'project_concurrency_manager','Project concurrency manager','Concurrency proof',false,true
        from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id
        where tenant.slug='project-concurrency-proof';
        insert into public.member_roles(tenant_id,member_id,role_id,assignment_source)
        select member.tenant_id,member.id,role.id,'manual'
        from public.organization_members member join public.roles role
          on role.tenant_id=member.tenant_id and role.organization_id=member.organization_id
        where member.user_id='86000000-0000-4000-8000-000000000001'
          and role.code='project_concurrency_manager';
        insert into public.role_permissions(tenant_id,role_id,permission_id)
        select role.tenant_id,role.id,permission.id
        from public.roles role join public.permissions permission on permission.code='project.manage'
        where role.code='project_concurrency_manager';
        commit;
      $setup$;

    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'project_concurrency_setup','begin';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'project_concurrency_setup',$lock_members$
        do $remote$ begin
          perform member.id
          from public.organization_members member
          where member.user_id in (
            '86000000-0000-4000-8000-000000000001',
            '86000000-0000-4000-8000-000000000002'
          )
          order by member.id
          for update;
        end $remote$;
      $lock_members$;

    foreach v_connection in array array['project_concurrency_a','project_concurrency_b'] loop
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'set statement_timeout = ''10s''';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'begin';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'set local role authenticated';
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using v_connection,'set local "request.jwt.claim.sub" = ''86000000-0000-4000-8000-000000000001''';
    end loop;
    execute format('select pid from %I.dblink($1,$2) as remote(pid integer)',v_extension_schema)
      into v_worker_a_pid using 'project_concurrency_a','select pg_backend_pid()';
    execute format('select pid from %I.dblink($1,$2) as remote(pid integer)',v_extension_schema)
      into v_worker_b_pid using 'project_concurrency_b','select pg_backend_pid()';
    execute format('select %I.dblink_send_query($1,$2)',v_extension_schema)
      into v_integer using 'project_concurrency_a',$query$
        select public.create_current_project_v2(
          'Concurrent command','Real overlap proof','Delivery',
          '86100000-0000-4000-8000-000000000002',10.00,'active','medium',
          '2026-12-01','2026-12-31',0,'Concurrent create A',
          '86200000-0000-4000-8000-000000000001','86200000-0000-4000-8000-000000000002'
        )
      $query$;
    v_wait_count:=0;
    v_waiting:=false;
    loop
      select exists(
        select 1 from pg_catalog.pg_stat_activity activity
        where activity.pid=v_worker_a_pid and activity.wait_event_type='Lock'
      ) into v_waiting;
      exit when v_waiting or v_wait_count>=200;
      v_wait_count:=v_wait_count+1;
      perform pg_sleep(0.005);
    end loop;
    if not v_waiting then
      raise exception 'first_project_command_did_not_wait_after_claim';
    end if;
    execute format('select %I.dblink_send_query($1,$2)',v_extension_schema)
      into v_integer using 'project_concurrency_b',$query$
        select public.create_current_project_v2(
          'Concurrent command','Real overlap proof','Delivery',
          '86100000-0000-4000-8000-000000000002',10.00,'active','medium',
          '2026-12-01','2026-12-31',0,'Concurrent create B',
          '86200000-0000-4000-8000-000000000003','86200000-0000-4000-8000-000000000002'
        )
      $query$;
    v_wait_count:=0;
    v_waiting:=false;
    loop
      select exists(
        select 1 from pg_catalog.pg_stat_activity activity
        where activity.pid=v_worker_b_pid and activity.wait_event_type='Lock'
      ) into v_waiting;
      exit when v_waiting or v_wait_count>=100;
      v_wait_count:=v_wait_count+1;
      perform pg_sleep(0.01);
    end loop;
    if v_waiting then
      perform set_config('test.project.lifecycle.concurrent_wait','true',true);
    end if;
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'project_concurrency_setup','commit';
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_a using 'project_concurrency_a';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'project_concurrency_a','commit';
    execute format('select result from %I.dblink_get_result($1) as remote(result jsonb)',v_extension_schema)
      into v_result_b using 'project_concurrency_b';
    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'project_concurrency_b','commit';
    execute format('select count from %I.dblink($1,$2) as remote(count bigint)',v_extension_schema)
      into v_count using 'project_concurrency_setup',$count$
        select count(*) from public.projects project
        join public.tenants tenant on tenant.id=project.tenant_id
        where tenant.slug='project-concurrency-proof' and project.name='Concurrent command'
      $count$;
    if v_result_a->>'outcome'='success' and v_result_b->>'outcome'='success'
       and v_result_a->>'id'=v_result_b->>'id' and v_count=1 then
      perform set_config('test.project.lifecycle.concurrent_same','true',true);
    end if;

    execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
      into v_status using 'project_concurrency_setup',$cleanup$
        begin;
        set local session_replication_role = replica;
        delete from public.audit_logs where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        set local session_replication_role = origin;
        delete from public.project_command_idempotency where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.tasks where project_id in (
          select project.id from public.projects project join public.tenants tenant on tenant.id=project.tenant_id where tenant.slug='project-concurrency-proof'
        );
        delete from public.project_members where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.projects where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.member_roles where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.role_permissions where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.external_identities where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.employee_profiles where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.roles where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.organization_members where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.identity_providers where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.organizations where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
        delete from public.tenants where slug='project-concurrency-proof';
        delete from auth.users where id in ('86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000002');
        commit;
      $cleanup$;
    foreach v_connection in array array['project_concurrency_setup','project_concurrency_a','project_concurrency_b'] loop
      execute format('select %I.dblink_disconnect($1)',v_extension_schema)
        into v_status using v_connection;
    end loop;
  exception when others then
    foreach v_connection in array array['project_concurrency_a','project_concurrency_b'] loop
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
        into v_status using 'project_concurrency_setup','rollback';
    exception when others then null;
    end;
    begin
      execute format('select %I.dblink_exec($1,$2)',v_extension_schema)
        into v_status using 'project_concurrency_setup',$cleanup$
          begin;
          set local session_replication_role = replica;
          delete from public.audit_logs where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          set local session_replication_role = origin;
          delete from public.project_command_idempotency where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          delete from public.tasks where project_id in (select id from public.projects where tenant_id in (select id from public.tenants where slug='project-concurrency-proof'));
          delete from public.project_members where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          delete from public.projects where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          delete from public.member_roles where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          delete from public.role_permissions where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          delete from public.external_identities where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          delete from public.employee_profiles where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          delete from public.roles where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          delete from public.organization_members where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          delete from public.identity_providers where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          delete from public.organizations where tenant_id in (select id from public.tenants where slug='project-concurrency-proof');
          delete from public.tenants where slug='project-concurrency-proof';
          delete from auth.users where id in ('86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000002');
          commit;
        $cleanup$;
    exception when others then null;
    end;
    foreach v_connection in array array['project_concurrency_setup','project_concurrency_a','project_concurrency_b'] loop
      begin
        execute format('select %I.dblink_disconnect($1)',v_extension_schema)
          into v_status using v_connection;
      exception when others then null;
      end;
    end loop;
    raise;
  end;
end;
$project_concurrency$;
select case when current_setting('test.project.lifecycle.dblink_available')='true'
  then ok(current_setting('test.project.lifecycle.concurrent_wait')='true','second same-key project command waits on the first real transaction')
  else ok(true,'concurrent same-key wait proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.project.lifecycle.dblink_available')='true'
  then ok(current_setting('test.project.lifecycle.concurrent_same')='true','concurrent same-key project commands return one canonical project')
  else ok(true,'concurrent same-key canonical replay # SKIP dblink extension or local connection unavailable')
end;

select * from finish();
rollback;
