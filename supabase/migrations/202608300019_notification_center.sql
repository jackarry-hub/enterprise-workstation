begin;

create table public.commercial_notifications (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  event_public_id uuid not null,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  recipient_member_id bigint not null,
  category text not null check (category in ('approval','expense','customer','knowledge','agent')),
  event_type text not null check (event_type ~ '^(approval|expense|customer|knowledge|agent)\.[a-z][a-z0-9_]{1,62}$'),
  entity_type text not null check (entity_type in ('approval','expense_report','customer','opportunity','knowledge_document','agent_invocation')),
  entity_public_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  summary text not null default '' check (length(summary) <= 500),
  target_path text not null check (
    length(target_path) between 1 and 300
    and target_path ~ '^/(approvals|finance|customers|knowledge|agents)(/|\?|$)'
    and target_path !~ '^(//|[a-zA-Z][a-zA-Z0-9+.-]*:)'
  ),
  delivery_status text not null default 'sent' check (delivery_status in ('pending','sending','sent','failed')),
  sent_at timestamptz,
  read_at timestamptz,
  last_error_code text check (last_error_code is null or length(last_error_code) <= 80),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, organization_id, recipient_member_id, event_public_id),
  foreign key (tenant_id, organization_id) references public.organizations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_id, recipient_member_id) references public.organization_members(tenant_id, organization_id, id) on delete cascade,
  check (read_at is null or delivery_status in ('sent','failed')),
  check ((delivery_status = 'sent' and sent_at is not null) or delivery_status <> 'sent')
);

create index commercial_notifications_recipient_created_idx
  on public.commercial_notifications(tenant_id, organization_id, recipient_member_id, created_at desc);
create index commercial_notifications_unread_idx
  on public.commercial_notifications(tenant_id, recipient_member_id, created_at desc) where read_at is null;

alter table public.commercial_notifications enable row level security;
alter table public.commercial_notifications force row level security;
create policy commercial_notification_recipient_read on public.commercial_notifications
for select to authenticated using (
  tenant_id = (select public.current_tenant_id())
  and exists (
    select 1 from public.organization_members member
    where member.tenant_id = commercial_notifications.tenant_id
      and member.organization_id = commercial_notifications.organization_id
      and member.id = commercial_notifications.recipient_member_id
      and member.user_id = (select auth.uid()) and member.status = 'active'
  )
);

create or replace function public.enqueue_commercial_notification(
  p_tenant_public_id uuid, p_organization_public_id uuid, p_recipient_member_id bigint,
  p_event_public_id uuid, p_category text, p_event_type text, p_entity_type text,
  p_entity_public_id uuid, p_title text, p_summary text, p_target_path text,
  p_delivery_status text default 'sent', p_error_code text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant bigint; v_organization bigint; v_row public.commercial_notifications%rowtype;
begin
  select tenant.id, organization.id into v_tenant, v_organization
  from public.tenants tenant join public.organizations organization on organization.tenant_id = tenant.id
  where tenant.public_id = p_tenant_public_id and tenant.status = 'active'
    and organization.public_id = p_organization_public_id;
  if not found or p_event_public_id is null or p_entity_public_id is null
    or p_delivery_status not in ('pending','sending','sent','failed')
    or not exists (select 1 from public.organization_members member where member.tenant_id=v_tenant and member.organization_id=v_organization and member.id=p_recipient_member_id and member.status='active') then
    raise exception 'invalid_notification' using errcode = '22023';
  end if;
  insert into public.commercial_notifications(event_public_id,tenant_id,organization_id,recipient_member_id,category,event_type,entity_type,entity_public_id,title,summary,target_path,delivery_status,sent_at,last_error_code)
  values(p_event_public_id,v_tenant,v_organization,p_recipient_member_id,p_category,p_event_type,p_entity_type,p_entity_public_id,btrim(p_title),coalesce(p_summary,''),p_target_path,p_delivery_status,case when p_delivery_status='sent' then clock_timestamp() else null end,p_error_code)
  on conflict(tenant_id,organization_id,recipient_member_id,event_public_id) do nothing;
  select * into v_row from public.commercial_notifications where tenant_id=v_tenant and organization_id=v_organization and recipient_member_id=p_recipient_member_id and event_public_id=p_event_public_id;
  return jsonb_build_object('notificationId',v_row.public_id,'state',v_row.delivery_status,'version',v_row.version);
end;
$$;

create or replace function public.current_notification_center()
returns table(
  notification_public_id uuid, event_public_id uuid, event_type text, category text,
  effective_status text, entity_type text, entity_public_id uuid, title text, summary text,
  target_path text, created_at timestamptz, sent_at timestamptz, read_at timestamptz,
  next_retry_at timestamptz, last_error_code text, version bigint, can_retry boolean
)
language sql stable security definer set search_path = '' as $$
  select inbox.notification_public_id,inbox.event_public_id,inbox.event_type,'task'::text,
    inbox.effective_status,'task'::text,inbox.task_public_id,inbox.task_title,
    '项目：'||inbox.project_name,
    '/projects/'||inbox.project_public_id::text||'?tab=tasks&task='||inbox.task_public_id::text,
    inbox.created_at,inbox.sent_at,inbox.read_at,inbox.next_retry_at,inbox.last_error_code,
    inbox.version,inbox.can_retry
  from public.current_task_notification_inbox() inbox
  union all
  select notification.public_id,notification.event_public_id,notification.event_type,notification.category,
    case when notification.read_at is not null then 'read' else notification.delivery_status end,
    notification.entity_type,notification.entity_public_id,notification.title,notification.summary,
    notification.target_path,notification.created_at,notification.sent_at,notification.read_at,
    null::timestamptz,notification.last_error_code,notification.version,false
  from public.commercial_notifications notification
  join public.organization_members member on member.tenant_id=notification.tenant_id
    and member.organization_id=notification.organization_id and member.id=notification.recipient_member_id
    and member.user_id=(select auth.uid()) and member.status='active'
  where notification.tenant_id=(select public.current_tenant_id())
  order by created_at desc limit 200;
$$;

create or replace function public.mark_current_notification_read(p_notification_public_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_row public.commercial_notifications%rowtype; v_result jsonb;
begin
  if p_notification_public_id is null or p_request_id is null then raise exception 'invalid_notification' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor(null); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_row from public.commercial_notifications where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and recipient_member_id=v_actor.member_id and public_id=p_notification_public_id for update;
  if found then
    if v_row.delivery_status not in ('sent','failed') then raise exception 'notification_not_delivered' using errcode='40001'; end if;
    if v_row.read_at is null then update public.commercial_notifications set read_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=v_row.id returning * into v_row; end if;
    return jsonb_build_object('id',v_row.public_id,'state','read','readAt',v_row.read_at,'version',v_row.version);
  end if;
  select public.mark_current_task_notification_read(p_notification_public_id,p_request_id) into v_result;
  return v_result;
end;
$$;

revoke all on table public.commercial_notifications from public,anon,authenticated,service_role;
grant select on table public.commercial_notifications to authenticated;
revoke all on sequence public.commercial_notifications_id_seq from public,anon,authenticated,service_role;
revoke all on function public.enqueue_commercial_notification(uuid,uuid,bigint,uuid,text,text,text,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_commercial_notification(uuid,uuid,bigint,uuid,text,text,text,uuid,text,text,text,text,text) to service_role;
revoke all on function public.current_notification_center() from public,anon;
grant execute on function public.current_notification_center() to authenticated;
revoke all on function public.mark_current_notification_read(uuid,uuid) from public,anon;
grant execute on function public.mark_current_notification_read(uuid,uuid) to authenticated;

commit;
