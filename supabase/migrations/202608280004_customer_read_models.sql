-- RLS-preserving CRM read models. These views keep list payloads bounded and
-- preserve numeric(18,2) values as decimal text before they reach JavaScript.

create view public.current_customer_opportunity_metrics
with (security_invoker=true, security_barrier=true)
as
select
  opportunity.tenant_id,
  opportunity.organization_id,
  opportunity.customer_id,
  count(*)::bigint as opportunity_count,
  coalesce(max(case opportunity.stage
    when 'lead' then 10 when 'qualified' then 40 when 'proposal' then 70
    when 'won' then 100 else 0 end) filter (where opportunity.stage<>'lost'),0)::integer as deal_progress,
  coalesce(sum(opportunity.amount) filter (
    where opportunity.stage='won' and opportunity.currency='CNY'
  ),0::numeric)::text as won_amount_cny
from public.opportunities opportunity
where opportunity.archived_at is null
group by opportunity.tenant_id,opportunity.organization_id,opportunity.customer_id;

create view public.current_customer_follow_up_metrics
with (security_invoker=true, security_barrier=true)
as
select
  follow_up.tenant_id,
  follow_up.organization_id,
  follow_up.customer_id,
  max(follow_up.occurred_at) as last_contact_at,
  min(follow_up.next_follow_up_at) filter (
    where follow_up.next_follow_up_at is not null
  ) as next_follow_up_at
from public.customer_follow_ups follow_up
where follow_up.archived_at is null
group by follow_up.tenant_id,follow_up.organization_id,follow_up.customer_id;

create view public.current_customer_opportunities
with (security_invoker=true, security_barrier=true)
as
select
  opportunity.id,
  opportunity.public_id,
  opportunity.tenant_id,
  opportunity.organization_id,
  opportunity.customer_id,
  opportunity.owner_member_id,
  opportunity.name,
  opportunity.stage,
  opportunity.amount::text as amount,
  opportunity.currency,
  opportunity.expected_close_on,
  opportunity.loss_reason,
  opportunity.version,
  opportunity.created_at,
  opportunity.updated_at,
  opportunity.archived_at
from public.opportunities opportunity;

create view public.current_customer_industries
with (security_invoker=true, security_barrier=true)
as
select customer.tenant_id,customer.organization_id,customer.industry
from public.customers customer
where customer.archived_at is null
group by customer.tenant_id,customer.organization_id,customer.industry;

revoke all on table public.current_customer_opportunity_metrics
  from public,anon,authenticated,service_role;
revoke all on table public.current_customer_follow_up_metrics
  from public,anon,authenticated,service_role;
revoke all on table public.current_customer_opportunities
  from public,anon,authenticated,service_role;
revoke all on table public.current_customer_industries
  from public,anon,authenticated,service_role;
grant select on table public.current_customer_opportunity_metrics to authenticated;
grant select on table public.current_customer_follow_up_metrics to authenticated;
grant select on table public.current_customer_opportunities to authenticated;
grant select on table public.current_customer_industries to authenticated;
