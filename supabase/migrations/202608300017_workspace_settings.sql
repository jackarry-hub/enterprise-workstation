begin;

create table public.workspace_settings (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  member_id bigint,
  namespace text not null check(namespace in ('organization','personal','notifications','scheduler')),
  payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object' and pg_column_size(payload)<=32768),
  version bigint not null default 1 check(version>0),
  updated_by_member_id bigint not null,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key(tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key(tenant_id,member_id) references public.organization_members(tenant_id,id) on delete cascade,
  foreign key(tenant_id,updated_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique nulls not distinct(tenant_id,organization_id,member_id,namespace),
  check((namespace in ('organization','scheduler') and member_id is null) or (namespace in ('personal','notifications') and member_id is not null))
);
alter table public.workspace_settings enable row level security; alter table public.workspace_settings force row level security;

create or replace function public.current_workspace_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record; v_organization public.organizations%rowtype; v_profile public.employee_profiles%rowtype; v_can_manage boolean; v_organization_row public.workspace_settings%rowtype; v_personal_row public.workspace_settings%rowtype; v_notification_row public.workspace_settings%rowtype; v_scheduler_row public.workspace_settings%rowtype;
begin
  select * into v_actor from public.current_agent_actor(null); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_organization from public.organizations where tenant_id=v_actor.tenant_id and id=v_actor.organization_id;
  select * into v_profile from public.employee_profiles where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and organization_member_id=v_actor.member_id and deleted_at is null;
  v_can_manage:=public.has_organization_permission(v_actor.organization_id,'settings.manage');
  select * into v_organization_row from public.workspace_settings where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and member_id is null and namespace='organization';
  select * into v_personal_row from public.workspace_settings where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and member_id=v_actor.member_id and namespace='personal';
  select * into v_notification_row from public.workspace_settings where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and member_id=v_actor.member_id and namespace='notifications';
  select * into v_scheduler_row from public.workspace_settings where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and member_id is null and namespace='scheduler';
  return jsonb_build_object(
    'organization',coalesce(v_organization_row.payload,jsonb_build_object('name',v_organization.name,'shortName',v_organization.name,'logoUrl','/brand/quantxy-logo.png','timezone','asia-shanghai','language','zh-cn','foundedDate','','workWeekStart','monday')),
    'profile',jsonb_build_object('name',coalesce(v_profile.display_name,''),'email',coalesce(v_profile.work_email,''),'avatarUrl',coalesce(v_profile.avatar_url,''),'source','feishu'),
    'personal',coalesce(v_personal_row.payload,'{"language":"zh-cn","dateFormat":"yyyy-mm-dd","followSystemTheme":false}'::jsonb),
    'notifications',coalesce(v_notification_row.payload,'{"inApp":true,"email":false,"dailyDigest":false}'::jsonb),
    'scheduler',coalesce(v_scheduler_row.payload,'{"workdayStart":"09:00","workdayEnd":"18:00","defaultPlanDays":14,"maxDailyHours":8}'::jsonb),
    'versions',jsonb_build_object('organization',coalesce(v_organization_row.version,0),'personal',coalesce(v_personal_row.version,0),'notifications',coalesce(v_notification_row.version,0),'scheduler',coalesce(v_scheduler_row.version,0)),
    'canManage',v_can_manage,'asOf',clock_timestamp()
  );
end;
$$;

create or replace function public.update_current_workspace_settings(p_namespace text,p_payload jsonb,p_expected_version bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_member bigint; v_current public.workspace_settings%rowtype; v_next public.workspace_settings%rowtype; v_keys text[]; v_can_manage boolean;
begin
  if p_namespace not in ('organization','personal','notifications','scheduler') or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>32768 or p_expected_version<0 or p_request_id is null then raise exception 'invalid_settings' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor(null); if not found then raise exception 'forbidden' using errcode='42501'; end if; v_can_manage:=public.has_organization_permission(v_actor.organization_id,'settings.manage');
  if p_namespace in ('organization','scheduler') and not v_can_manage then raise exception 'forbidden' using errcode='42501'; end if; v_member:=case when p_namespace in ('personal','notifications') then v_actor.member_id else null end;
  select array_agg(key order by key) into v_keys from jsonb_object_keys(p_payload) key;
  if p_namespace='organization' and (v_keys<>array['foundedDate','language','logoUrl','name','shortName','timezone','workWeekStart']::text[] or length(btrim(coalesce(p_payload->>'name',''))) not between 2 and 120 or length(btrim(coalesce(p_payload->>'shortName',''))) not between 1 and 40 or length(coalesce(p_payload->>'logoUrl',''))>500 or coalesce(p_payload->>'timezone','') not in ('asia-shanghai','asia-singapore') or coalesce(p_payload->>'language','') not in ('zh-cn','en') or coalesce(p_payload->>'workWeekStart','') not in ('monday','sunday') or (coalesce(p_payload->>'foundedDate','')<>'' and (p_payload->>'foundedDate')!~'^\d{4}-\d{2}-\d{2}$')) then raise exception 'invalid_organization_settings' using errcode='22023'; end if;
  if p_namespace='personal' and (v_keys is distinct from array['dateFormat','followSystemTheme','language']::text[] or coalesce(p_payload->>'language','') not in ('zh-cn','en') or coalesce(p_payload->>'dateFormat','') not in ('yyyy-mm-dd','yyyy-mm-dd-cn') or jsonb_typeof(p_payload->'followSystemTheme') is distinct from 'boolean') then raise exception 'invalid_personal_settings' using errcode='22023'; end if;
  if p_namespace='notifications' and (v_keys is distinct from array['dailyDigest','email','inApp']::text[] or jsonb_typeof(p_payload->'inApp') is distinct from 'boolean' or jsonb_typeof(p_payload->'email') is distinct from 'boolean' or jsonb_typeof(p_payload->'dailyDigest') is distinct from 'boolean') then raise exception 'invalid_notification_settings' using errcode='22023'; end if;
  if p_namespace='scheduler' and (v_keys<>array['defaultPlanDays','maxDailyHours','workdayEnd','workdayStart']::text[] or coalesce(p_payload->>'workdayStart','')!~'^([01]\d|2[0-3]):[0-5]\d$' or coalesce(p_payload->>'workdayEnd','')!~'^([01]\d|2[0-3]):[0-5]\d$' or coalesce((p_payload->>'defaultPlanDays')~'^\d+$',false)=false or (p_payload->>'defaultPlanDays')::integer not between 1 and 90 or coalesce((p_payload->>'maxDailyHours')~'^\d+$',false)=false or (p_payload->>'maxDailyHours')::integer not between 1 and 16) then raise exception 'invalid_scheduler_settings' using errcode='22023'; end if;
  select * into v_current from public.workspace_settings where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and member_id is not distinct from v_member and namespace=p_namespace for update;
  if found and v_current.version<>p_expected_version then raise exception 'settings_version_conflict' using errcode='40001'; end if; if not found and p_expected_version<>0 then raise exception 'settings_version_conflict' using errcode='40001'; end if;
  insert into public.workspace_settings(tenant_id,organization_id,member_id,namespace,payload,version,updated_by_member_id) values(v_actor.tenant_id,v_actor.organization_id,v_member,p_namespace,p_payload,1,v_actor.member_id)
    on conflict(tenant_id,organization_id,member_id,namespace) do update set payload=excluded.payload,version=public.workspace_settings.version+1,updated_by_member_id=excluded.updated_by_member_id,updated_at=clock_timestamp() returning * into v_next;
  if p_namespace in ('organization','scheduler') then perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'settings.'||p_namespace||'.updated','workspace_settings',v_next.id::text,p_request_id,v_current.payload,jsonb_build_object('version',v_next.version)); end if;
  return jsonb_build_object('namespace',p_namespace,'version',v_next.version,'updatedAt',v_next.updated_at,'requestId',p_request_id);
end;
$$;

revoke all on table public.workspace_settings from public,anon,authenticated,service_role;
revoke all on sequence public.workspace_settings_id_seq from public,anon,authenticated,service_role;
revoke all on function public.current_workspace_settings() from public,anon; grant execute on function public.current_workspace_settings() to authenticated;
revoke all on function public.update_current_workspace_settings(text,jsonb,bigint,uuid) from public,anon; grant execute on function public.update_current_workspace_settings(text,jsonb,bigint,uuid) to authenticated;

commit;
