begin;

alter table public.approval_templates drop constraint if exists approval_templates_approval_type_check;
alter table public.approval_templates add constraint approval_templates_approval_type_check check (approval_type in ('reimbursement','purchase','contract','agent_permission'));
alter table public.approvals drop constraint if exists approvals_approval_type_check;
alter table public.approvals add constraint approvals_approval_type_check check (approval_type in ('leave','reimbursement','purchase','contract','agent_permission'));

alter table public.agent_permissions add column public_id uuid not null default gen_random_uuid();
alter table public.agent_permissions add column granted_by_member_id bigint;
alter table public.agent_permissions add column expires_at timestamptz;
alter table public.agent_permissions add column revoked_at timestamptz;
alter table public.agent_permissions add column source_request_id bigint;
alter table public.agent_permissions add constraint agent_permissions_public_id_unique unique(public_id);
alter table public.agent_permissions add constraint agent_permissions_granted_by_fk foreign key(tenant_id,granted_by_member_id) references public.organization_members(tenant_id,id) on delete restrict;
alter table public.agent_permissions add constraint agent_permissions_expiry_check check (expires_at is null or expires_at>created_at);

create table public.agent_permission_requests (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  agent_id bigint not null,
  requester_member_id bigint not null,
  approval_id bigint,
  idempotency_key uuid not null,
  request_id uuid not null,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  requested_expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','revoked','expired')),
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  foreign key(tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key(tenant_id,organization_id,agent_id) references public.agent_definitions(tenant_id,organization_id,id) on delete cascade,
  foreign key(tenant_id,requester_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,approval_id) references public.approvals(tenant_id,organization_id,id) on delete restrict,
  unique(tenant_id,requester_member_id,idempotency_key),
  unique(tenant_id,request_id),
  check (requested_expires_at>created_at and requested_expires_at<=created_at+interval '90 days')
);
alter table public.agent_permissions add constraint agent_permissions_source_request_fk foreign key(source_request_id) references public.agent_permission_requests(id) on delete restrict;

alter table public.agent_permission_requests enable row level security; alter table public.agent_permission_requests force row level security;
create policy agent_permission_requests_scoped_read on public.agent_permission_requests for select to authenticated using (
  tenant_id=(select public.current_tenant_id()) and (
    exists(select 1 from public.organization_members member where member.tenant_id=agent_permission_requests.tenant_id and member.id=requester_member_id and member.user_id=(select auth.uid()) and member.status='active')
    or (select public.has_organization_permission(organization_id,'agent.manage'))
  )
);
grant select on public.agent_permission_requests to authenticated;

insert into public.approval_templates(tenant_id,organization_id,template_key,version,approval_type,title,description,form_schema,step_definitions,is_active)
select organization.tenant_id,organization.id,'agent.permission',1,'agent_permission','Agent 权限申请','申请有期限、可撤销的 Agent 调用权限。',
  '{"fields":[{"key":"agentId","label":"Agent ID","type":"uuid","required":true},{"key":"agentName","label":"Agent 名称","type":"text","required":true,"maxLength":120},{"key":"reason","label":"申请理由","type":"text","required":true,"maxLength":500},{"key":"expiresAt","label":"有效期至","type":"date","required":true}]}'::jsonb,
  '[{"name":"管理员审批","approverRule":{"kind":"role","roleCode":"owner"}}]'::jsonb,true
from public.organizations organization
where not exists(select 1 from public.approval_templates template where template.tenant_id=organization.tenant_id and template.organization_id=organization.id and template.template_key='agent.permission' and template.is_active);

create or replace function public.request_current_agent_permission(p_agent_public_id uuid,p_reason text,p_expires_at timestamptz,p_idempotency_key uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_agent public.agent_definitions%rowtype; v_request public.agent_permission_requests%rowtype; v_template uuid; v_approval_result jsonb; v_approval_id bigint; v_existing public.agent_permission_requests%rowtype;
begin
  if p_agent_public_id is null or length(btrim(coalesce(p_reason,''))) not between 5 and 500 or p_expires_at is null or p_expires_at<=clock_timestamp()+interval '1 hour' or p_expires_at>clock_timestamp()+interval '90 days' or p_idempotency_key is null or p_request_id is null or p_idempotency_key=p_request_id then raise exception 'invalid_agent_permission_request' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor(null); if not found or not public.has_organization_permission(v_actor.organization_id,'approval.submit') then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_agent from public.agent_definitions where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_agent_public_id and status='enabled' and deleted_at is null; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||':'||v_actor.member_id::text||':'||p_idempotency_key::text,0));
  select * into v_existing from public.agent_permission_requests where tenant_id=v_actor.tenant_id and requester_member_id=v_actor.member_id and idempotency_key=p_idempotency_key;
  if found then if v_existing.agent_id<>v_agent.id or v_existing.reason<>btrim(p_reason) or v_existing.requested_expires_at<>p_expires_at then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('requestId',v_existing.public_id,'approvalId',(select public_id from public.approvals where id=v_existing.approval_id),'status',v_existing.status,'alreadyExists',true); end if;
  if exists(select 1 from public.agent_permission_requests request where request.tenant_id=v_actor.tenant_id and request.agent_id=v_agent.id and request.requester_member_id=v_actor.member_id and request.status='pending') then raise exception 'agent_permission_request_pending' using errcode='55000'; end if;
  select public_id into v_template from public.approval_templates where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and template_key='agent.permission' and is_active;
  if v_template is null then raise exception 'agent_permission_template_missing' using errcode='55000'; end if;
  insert into public.agent_permission_requests(tenant_id,organization_id,agent_id,requester_member_id,idempotency_key,request_id,reason,requested_expires_at)
    values(v_actor.tenant_id,v_actor.organization_id,v_agent.id,v_actor.member_id,p_idempotency_key,p_request_id,btrim(p_reason),p_expires_at) returning * into v_request;
  v_approval_result:=public.submit_current_approval(v_template,jsonb_build_object('agentId',v_agent.public_id,'agentName',v_agent.name,'reason',v_request.reason,'expiresAt',to_char(p_expires_at at time zone 'UTC','YYYY-MM-DD')),p_idempotency_key,p_request_id);
  if v_approval_result->>'outcome'<>'success' then raise exception 'agent_permission_approval_failed' using errcode='55000'; end if;
  select id into v_approval_id from public.approvals where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=(v_approval_result->'entity'->>'id')::uuid;
  if v_approval_id is null then raise exception 'agent_permission_approval_missing' using errcode='P0001'; end if;
  update public.agent_permission_requests set approval_id=v_approval_id where id=v_request.id;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'agent.permission.requested','agent_permission_request',v_request.public_id::text,p_request_id,null,jsonb_build_object('agentId',v_agent.public_id,'approvalId',v_approval_result->'entity'->>'id','expiresAt',p_expires_at));
  return jsonb_build_object('requestId',v_request.public_id,'approvalId',v_approval_result->'entity'->>'id','status','pending','alreadyExists',false);
end;
$$;

create or replace function public.apply_agent_permission_approval()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_request public.agent_permission_requests%rowtype; v_approver bigint; v_permission public.agent_permissions%rowtype;
begin
  if old.status is not distinct from new.status or new.status not in ('approved','rejected') then return new; end if;
  select * into v_request from public.agent_permission_requests where tenant_id=new.tenant_id and organization_id=new.organization_id and approval_id=new.id and status='pending' for update;
  if not found then return new; end if;
  if new.status='rejected' then update public.agent_permission_requests set status='rejected',decided_at=clock_timestamp() where id=v_request.id; return new; end if;
  select member.id into v_approver from public.employee_profiles profile join public.organization_members member on member.tenant_id=profile.tenant_id and member.organization_id=profile.organization_id and member.id=profile.organization_member_id where profile.tenant_id=new.tenant_id and profile.organization_id=new.organization_id and profile.id=new.owner_employee_id and profile.deleted_at is null;
  select * into v_permission from public.agent_permissions where tenant_id=v_request.tenant_id and organization_id=v_request.organization_id and agent_id=v_request.agent_id and scope_type='member' and member_id=v_request.requester_member_id and deleted_at is null for update;
  if found then update public.agent_permissions set min_job_level=1,granted_by_member_id=v_approver,expires_at=v_request.requested_expires_at,revoked_at=null,source_request_id=v_request.id,updated_at=clock_timestamp() where id=v_permission.id;
  else insert into public.agent_permissions(tenant_id,organization_id,agent_id,scope_type,member_id,min_job_level,created_by_member_id,granted_by_member_id,expires_at,source_request_id) values(v_request.tenant_id,v_request.organization_id,v_request.agent_id,'member',v_request.requester_member_id,1,v_approver,v_approver,v_request.requested_expires_at,v_request.id);
  end if;
  update public.agent_permission_requests set status='approved',decided_at=clock_timestamp() where id=v_request.id;
  return new;
end;
$$;
create trigger approvals_apply_agent_permission after update of status on public.approvals for each row execute function public.apply_agent_permission_approval();

create or replace function public.list_current_agent_permission_requests(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record; v_manage boolean;
begin
  if p_limit not between 1 and 200 then raise exception 'invalid_limit' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor(null); if not found then raise exception 'forbidden' using errcode='42501'; end if; v_manage:=public.has_organization_permission(v_actor.organization_id,'agent.manage');
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',request.public_id,'agentId',agent.public_id,'agentName',agent.name,'approvalId',approval.public_id,'reason',request.reason,'expiresAt',request.requested_expires_at,'status',request.status,'createdAt',request.created_at) order by request.created_at desc,request.id desc) from (select * from public.agent_permission_requests where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and (v_manage or requester_member_id=v_actor.member_id) order by created_at desc,id desc limit p_limit) request join public.agent_definitions agent on agent.id=request.agent_id left join public.approvals approval on approval.id=request.approval_id),'[]'::jsonb));
end;
$$;

revoke all on function public.request_current_agent_permission(uuid,text,timestamptz,uuid,uuid) from public,anon; grant execute on function public.request_current_agent_permission(uuid,text,timestamptz,uuid,uuid) to authenticated;
revoke all on function public.list_current_agent_permission_requests(integer) from public,anon; grant execute on function public.list_current_agent_permission_requests(integer) to authenticated;

commit;
