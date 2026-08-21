-- Ordinary employees execute and submit their own tasks. Task dispatch stays
-- with owners, administrators and department/project managers.
delete from public.role_permissions assignment
using public.roles role, public.permissions permission
where assignment.role_id = role.id
  and assignment.permission_id = permission.id
  and role.code = 'employee'
  and role.organization_id is null
  and permission.code = 'task.manage';
