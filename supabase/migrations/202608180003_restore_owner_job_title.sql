update public.employee_profiles profile
set job_title = 'CEO', updated_at = clock_timestamp()
from public.organization_members member
join public.member_roles assignment
  on assignment.tenant_id = member.tenant_id
 and assignment.member_id = member.id
join public.roles role
  on role.tenant_id = assignment.tenant_id
 and role.id = assignment.role_id
where profile.tenant_id = member.tenant_id
  and profile.organization_member_id = member.id
  and profile.deleted_at is null
  and role.code = 'owner'
  and profile.job_title = '员工';
