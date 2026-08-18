create or replace function public.apply_feishu_directory_sync(
  p_tenant_public_id uuid,
  p_actor_auth_user_id uuid,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_provider_id bigint;
  v_provider_tenant_key text;
  v_connection_id bigint;
  v_sync_run_id bigint;
  v_started_at timestamptz := clock_timestamp();
  v_item jsonb;
  v_external_id text;
  v_department_id bigint;
  v_parent_department_id bigint;
  v_position_id bigint;
  v_member_id bigint;
  v_profile_id bigint;
  v_role_id bigint;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_deactivated integer := 0;
  v_departments integer;
  v_employees integer;
  v_positions integer;
  v_complete boolean;
  v_is_active boolean;
  v_open_id text;
  v_user_id text;
  v_email text;
  v_department_external_id text;
  v_job_title_external_id text;
begin
  if p_tenant_public_id is null or p_actor_auth_user_id is null
     or jsonb_typeof(p_snapshot) <> 'object'
     or jsonb_typeof(p_snapshot -> 'departments') <> 'array'
     or jsonb_typeof(p_snapshot -> 'positions') <> 'array'
     or jsonb_typeof(p_snapshot -> 'employees') <> 'array'
     or jsonb_typeof(p_snapshot -> 'complete') <> 'boolean' then
    raise exception 'Directory snapshot is invalid' using errcode = '22023';
  end if;

  v_departments := jsonb_array_length(p_snapshot -> 'departments');
  v_positions := jsonb_array_length(p_snapshot -> 'positions');
  v_employees := jsonb_array_length(p_snapshot -> 'employees');
  v_complete := (p_snapshot ->> 'complete')::boolean;
  if v_departments > 10000 or v_positions > 10000 or v_employees > 50000 then
    raise exception 'Directory snapshot is too large' using errcode = '22023';
  end if;

  select tenant.id, organization.id
  into strict v_tenant_id, v_organization_id
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id = tenant.id
  where tenant.public_id = p_tenant_public_id
    and tenant.status = 'active'
  order by organization.id
  limit 1;

  select member.id into v_actor_member_id
  from public.organization_members member
  where member.tenant_id = v_tenant_id
    and member.organization_id = v_organization_id
    and member.user_id = p_actor_auth_user_id
    and member.status = 'active';
  if v_actor_member_id is null then
    raise exception 'Directory actor does not belong to this tenant'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.member_roles assignment
    join public.roles role
      on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
    where assignment.tenant_id = v_tenant_id
      and assignment.member_id = v_actor_member_id
      and role.code in ('owner', 'admin')
      and role.is_enabled
  ) then
    raise exception 'Only an owner or administrator can synchronize the directory'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('directory-sync:' || v_tenant_id::text, 0)
  );

  select provider.id, provider.provider_tenant_key
  into strict v_provider_id, v_provider_tenant_key
  from public.identity_providers provider
  where provider.tenant_id = v_tenant_id
    and provider.provider_code = 'feishu'
    and provider.status = 'active';

  insert into public.directory_connections (
    tenant_id, organization_id, identity_provider_id, provider_type,
    external_tenant_key, sync_mode, status
  ) values (
    v_tenant_id, v_organization_id, v_provider_id, 'feishu',
    v_provider_tenant_key, 'manual', 'active'
  )
  on conflict (tenant_id, identity_provider_id) do update set
    organization_id = excluded.organization_id,
    external_tenant_key = excluded.external_tenant_key,
    status = 'active',
    updated_at = clock_timestamp()
  returning id into v_connection_id;

  insert into public.directory_sync_runs (
    tenant_id, organization_id, connection_id, actor_member_id,
    status, snapshot_complete, departments_seen, employees_seen,
    positions_seen, started_at
  ) values (
    v_tenant_id, v_organization_id, v_connection_id, v_actor_member_id,
    'running', v_complete, v_departments, v_employees, v_positions, v_started_at
  ) returning id into v_sync_run_id;

  perform public.append_audit_log(
    v_tenant_id, v_organization_id, p_actor_auth_user_id, v_actor_member_id,
    'directory.sync_started', 'directory_sync_run', v_sync_run_id::text,
    null, null, jsonb_build_object(
      'departments', v_departments, 'employees', v_employees,
      'positions', v_positions, 'complete', v_complete
    )
  );

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'departments')
  loop
    v_external_id := nullif(btrim(v_item ->> 'externalId'), '');
    if v_external_id is null or nullif(btrim(v_item ->> 'name'), '') is null then
      raise exception 'Directory department is invalid' using errcode = '22023';
    end if;

    select link.department_id into v_department_id
    from public.directory_entity_links link
    where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
      and link.entity_type = 'department' and link.external_id = v_external_id;
    if v_department_id is null then
      select department.id into v_department_id
      from public.departments department
      where department.tenant_id = v_tenant_id
        and department.organization_id = v_organization_id
        and department.name = btrim(v_item ->> 'name')
        and department.deleted_at is null
      order by department.id limit 1;
    end if;
    if v_department_id is null then
      insert into public.departments (
        tenant_id, organization_id, code, name, description,
        status, sort_order
      ) values (
        v_tenant_id, v_organization_id,
        'FS_' || upper(substr(md5(v_external_id), 1, 20)),
        btrim(v_item ->> 'name'), '飞书通讯录同步', 'active', 1000
      ) returning id into v_department_id;
      v_inserted := v_inserted + 1;
    else
      update public.departments set
        name = btrim(v_item ->> 'name'), status = 'active',
        deleted_at = null, updated_at = clock_timestamp()
      where tenant_id = v_tenant_id and id = v_department_id;
      v_updated := v_updated + 1;
    end if;

    insert into public.directory_entity_links (
      tenant_id, organization_id, connection_id, entity_type,
      external_id, external_identifiers, department_id, last_seen_at
    ) values (
      v_tenant_id, v_organization_id, v_connection_id, 'department',
      v_external_id,
      jsonb_strip_nulls(jsonb_build_object(
        'openDepartmentId', v_external_id,
        'departmentId', nullif(btrim(v_item ->> 'departmentId'), '')
      )),
      v_department_id, clock_timestamp()
    )
    on conflict (tenant_id, connection_id, entity_type, external_id)
    do update set department_id = excluded.department_id,
      external_identifiers = excluded.external_identifiers,
      last_seen_at = excluded.last_seen_at, updated_at = clock_timestamp();
  end loop;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'departments')
  loop
    v_external_id := nullif(btrim(v_item ->> 'externalId'), '');
    select link.department_id into v_department_id
    from public.directory_entity_links link
    where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
      and link.entity_type = 'department' and link.external_id = v_external_id;
    v_parent_department_id := null;
    if nullif(btrim(v_item ->> 'parentExternalId'), '') is not null then
      select link.department_id into v_parent_department_id
      from public.directory_entity_links link
      where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
        and link.entity_type = 'department'
        and link.external_id = btrim(v_item ->> 'parentExternalId');
    end if;
    update public.departments set parent_department_id = v_parent_department_id,
      updated_at = clock_timestamp()
    where tenant_id = v_tenant_id and id = v_department_id;
  end loop;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'positions')
  loop
    v_external_id := nullif(btrim(v_item ->> 'externalId'), '');
    if v_external_id is null or nullif(btrim(v_item ->> 'name'), '') is null then
      raise exception 'Directory position is invalid' using errcode = '22023';
    end if;
    select link.position_template_id into v_position_id
    from public.directory_entity_links link
    where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
      and link.entity_type = 'position' and link.external_id = v_external_id;
    if v_position_id is null then
      select position.id into v_position_id
      from public.position_templates position
      where position.tenant_id = v_tenant_id
        and position.organization_id = v_organization_id
        and position.name = btrim(v_item ->> 'name')
        and position.deleted_at is null
      order by position.id limit 1;
    end if;
    if v_position_id is null then
      insert into public.position_templates (
        tenant_id, organization_id, code, name, category,
        description, source, status
      ) values (
        v_tenant_id, v_organization_id,
        'FS_' || upper(substr(md5(v_external_id), 1, 20)),
        btrim(v_item ->> 'name'), '飞书职位', '飞书通讯录同步',
        'feishu', 'active'
      ) returning id into v_position_id;
      v_inserted := v_inserted + 1;
    else
      update public.position_templates set
        name = btrim(v_item ->> 'name'), status = 'active',
        deleted_at = null, updated_at = clock_timestamp()
      where tenant_id = v_tenant_id and id = v_position_id;
      v_updated := v_updated + 1;
    end if;
    insert into public.directory_entity_links (
      tenant_id, organization_id, connection_id, entity_type,
      external_id, external_identifiers, position_template_id, last_seen_at
    ) values (
      v_tenant_id, v_organization_id, v_connection_id, 'position',
      v_external_id, jsonb_build_object('jobTitleId', v_external_id),
      v_position_id, clock_timestamp()
    ) on conflict (tenant_id, connection_id, entity_type, external_id)
    do update set position_template_id = excluded.position_template_id,
      external_identifiers = excluded.external_identifiers,
      last_seen_at = excluded.last_seen_at, updated_at = clock_timestamp();
  end loop;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'employees')
  loop
    v_open_id := nullif(lower(btrim(v_item ->> 'openId')), '');
    if v_open_id is null or nullif(btrim(v_item ->> 'name'), '') is null then
      raise exception 'Directory employee is invalid' using errcode = '22023';
    end if;
    v_user_id := nullif(btrim(v_item ->> 'userId'), '');
    v_email := nullif(lower(btrim(v_item ->> 'email')), '');
    v_department_external_id := nullif(btrim(v_item ->> 'primaryDepartmentExternalId'), '');
    v_job_title_external_id := nullif(btrim(v_item ->> 'jobTitleExternalId'), '');
    v_is_active := coalesce((v_item ->> 'isActive')::boolean, true);
    v_department_id := null;
    v_position_id := null;
    if v_department_external_id is not null then
      select link.department_id into v_department_id
      from public.directory_entity_links link
      where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
        and link.entity_type = 'department' and link.external_id = v_department_external_id;
    end if;
    if v_job_title_external_id is not null then
      select link.position_template_id into v_position_id
      from public.directory_entity_links link
      where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
        and link.entity_type = 'position' and link.external_id = v_job_title_external_id;
    end if;

    select link.employee_profile_id into v_profile_id
    from public.directory_entity_links link
    where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
      and link.entity_type = 'employee' and link.external_id = v_open_id;
    if v_profile_id is null then
      select profile.id into v_profile_id
      from public.external_identities identity
      join public.employee_profiles profile
        on profile.tenant_id = identity.tenant_id
       and profile.organization_member_id = identity.organization_member_id
       and profile.deleted_at is null
      where identity.tenant_id = v_tenant_id
        and identity.identity_provider_id = v_provider_id
        and identity.provider_subject = 'open_id:' || v_open_id
      limit 1;
    end if;

    if v_profile_id is null then
      insert into public.organization_members (
        tenant_id, organization_id, user_id, status
      ) values (
        v_tenant_id, v_organization_id, null,
        case when v_is_active then 'invited' else 'suspended' end
      ) returning id into v_member_id;
      insert into public.employee_profiles (
        tenant_id, organization_id, organization_member_id, employee_no,
        display_name, work_email, department_id, job_title,
        position_template_id, employment_status, skills
      ) values (
        v_tenant_id, v_organization_id, v_member_id,
        coalesce(v_user_id, v_open_id), btrim(v_item ->> 'name'), v_email,
        v_department_id, coalesce(nullif(btrim(v_item ->> 'jobTitle'), ''), '员工'),
        v_position_id, case when v_is_active then 'active' else 'departed' end,
        '{}'
      ) returning id into v_profile_id;
      v_inserted := v_inserted + 1;
    else
      select profile.organization_member_id into v_member_id
      from public.employee_profiles profile
      where profile.tenant_id = v_tenant_id and profile.id = v_profile_id;
      update public.employee_profiles set
        display_name = btrim(v_item ->> 'name'),
        work_email = coalesce(v_email, work_email),
        department_id = coalesce(v_department_id, department_id),
        job_title = coalesce(nullif(btrim(v_item ->> 'jobTitle'), ''), job_title),
        position_template_id = coalesce(v_position_id, position_template_id),
        employment_status = case when v_is_active then 'active' else 'departed' end,
        departure_date = case when v_is_active then null else current_date end,
        updated_at = clock_timestamp()
      where tenant_id = v_tenant_id and id = v_profile_id;
      update public.organization_members set
        status = case
          when v_is_active and user_id is null then 'invited'
          when v_is_active then 'active'
          else 'suspended'
        end
      where tenant_id = v_tenant_id and id = v_member_id;
      v_updated := v_updated + 1;
    end if;

    insert into public.external_identities (
      tenant_id, organization_id, organization_member_id,
      identity_provider_id, provider_subject, provider_tenant_key,
      provider_match_keys, verified_email, status
    ) values (
      v_tenant_id, v_organization_id, v_member_id, v_provider_id,
      'open_id:' || v_open_id, v_provider_tenant_key,
      array_remove(array['open_id:' || v_open_id,
        case when v_email is not null then 'email:' || v_email end], null),
      v_email, case when v_is_active then 'invited' else 'revoked' end
    )
    on conflict (tenant_id, identity_provider_id, organization_member_id)
    do update set
      provider_subject = excluded.provider_subject,
      provider_match_keys = excluded.provider_match_keys,
      verified_email = coalesce(excluded.verified_email, public.external_identities.verified_email),
      status = case
        when not v_is_active then 'revoked'
        when public.external_identities.auth_user_id is not null then 'active'
        else 'invited'
      end;

    insert into public.directory_entity_links (
      tenant_id, organization_id, connection_id, entity_type,
      external_id, external_identifiers, employee_profile_id, last_seen_at
    ) values (
      v_tenant_id, v_organization_id, v_connection_id, 'employee', v_open_id,
      jsonb_strip_nulls(jsonb_build_object('openId', v_open_id, 'userId', v_user_id)),
      v_profile_id, clock_timestamp()
    ) on conflict (tenant_id, connection_id, entity_type, external_id)
    do update set employee_profile_id = excluded.employee_profile_id,
      external_identifiers = excluded.external_identifiers,
      last_seen_at = excluded.last_seen_at, updated_at = clock_timestamp();

    delete from public.member_roles assignment
    where assignment.tenant_id = v_tenant_id
      and assignment.member_id = v_member_id
      and assignment.assignment_source = 'directory';
    if v_is_active and not exists (
      select 1 from public.member_roles assignment
      join public.roles role
        on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
      where assignment.tenant_id = v_tenant_id
        and assignment.member_id = v_member_id
        and role.code in ('owner', 'admin')
    ) then
      select role.id into strict v_role_id
      from public.roles role
      where role.tenant_id = v_tenant_id and role.is_enabled
        and role.code = case when exists (
          select 1 from jsonb_array_elements(p_snapshot -> 'departments') department
          where lower(btrim(department ->> 'leaderOpenId')) = v_open_id
        ) then 'department_head' else 'employee' end
      order by role.organization_id nulls last limit 1;
      insert into public.member_roles (
        tenant_id, member_id, role_id, assignment_source
      ) values (v_tenant_id, v_member_id, v_role_id, 'directory')
      on conflict (tenant_id, member_id, role_id) do nothing;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'departments')
  loop
    select department_link.department_id, member.id
    into v_department_id, v_member_id
    from public.directory_entity_links department_link
    left join public.directory_entity_links employee_link
      on employee_link.tenant_id = department_link.tenant_id
     and employee_link.connection_id = department_link.connection_id
     and employee_link.entity_type = 'employee'
     and employee_link.external_id = lower(btrim(v_item ->> 'leaderOpenId'))
    left join public.employee_profiles profile
      on profile.tenant_id = employee_link.tenant_id
     and profile.id = employee_link.employee_profile_id
    left join public.organization_members member
      on member.tenant_id = profile.tenant_id
     and member.id = profile.organization_member_id
    where department_link.tenant_id = v_tenant_id
      and department_link.connection_id = v_connection_id
      and department_link.entity_type = 'department'
      and department_link.external_id = btrim(v_item ->> 'externalId');
    update public.departments set leader_member_id = v_member_id,
      updated_at = clock_timestamp()
    where tenant_id = v_tenant_id and id = v_department_id;
  end loop;

  if v_complete then
    update public.employee_profiles profile set
      employment_status = 'departed', departure_date = current_date,
      updated_at = clock_timestamp()
    from public.directory_entity_links link
    where link.tenant_id = v_tenant_id
      and link.connection_id = v_connection_id
      and link.entity_type = 'employee'
      and link.employee_profile_id = profile.id
      and link.last_seen_at < v_started_at
      and not exists (
        select 1 from public.member_roles assignment
        join public.roles role
          on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
        where assignment.tenant_id = v_tenant_id
          and assignment.member_id = profile.organization_member_id
          and role.code in ('owner', 'admin')
      );
    get diagnostics v_deactivated = row_count;

    update public.organization_members member set status = 'suspended'
    from public.employee_profiles profile
    where profile.tenant_id = v_tenant_id
      and profile.organization_member_id = member.id
      and profile.employment_status = 'departed'
      and profile.updated_at >= v_started_at;
    update public.external_identities identity set status = 'revoked',
      updated_at = clock_timestamp()
    from public.employee_profiles profile
    where profile.tenant_id = v_tenant_id
      and profile.organization_member_id = identity.organization_member_id
      and identity.identity_provider_id = v_provider_id
      and profile.employment_status = 'departed'
      and profile.updated_at >= v_started_at;
  end if;

  update public.directory_sync_runs set
    status = 'completed', inserted_count = v_inserted,
    updated_count = v_updated, deactivated_count = v_deactivated,
    completed_at = clock_timestamp()
  where tenant_id = v_tenant_id and id = v_sync_run_id;
  update public.directory_connections set
    last_sync_at = clock_timestamp(), status = 'active', updated_at = clock_timestamp()
  where tenant_id = v_tenant_id and id = v_connection_id;

  perform public.append_audit_log(
    v_tenant_id, v_organization_id, p_actor_auth_user_id, v_actor_member_id,
    'directory.sync_completed', 'directory_sync_run', v_sync_run_id::text,
    null, null, jsonb_build_object(
      'departments', v_departments, 'employees', v_employees,
      'positions', v_positions, 'inserted', v_inserted,
      'updated', v_updated, 'deactivated', v_deactivated
    )
  );

  return jsonb_build_object(
    'status', 'completed',
    'departmentCount', v_departments,
    'employeeCount', v_employees,
    'positionCount', v_positions,
    'insertedCount', v_inserted,
    'updatedCount', v_updated,
    'deactivatedCount', v_deactivated
  );
exception when others then
  if v_sync_run_id is not null then
    update public.directory_sync_runs set status = 'failed', error_count = 1,
      completed_at = clock_timestamp()
    where tenant_id = v_tenant_id and id = v_sync_run_id;
  end if;
  raise;
end;
$$;

revoke all on function public.apply_feishu_directory_sync(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_feishu_directory_sync(uuid, uuid, jsonb)
  to service_role;
