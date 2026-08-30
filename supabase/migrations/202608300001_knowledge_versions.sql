begin;

alter table public.knowledge_documents
  add column tenant_id bigint,
  add column owner_member_id bigint,
  add column archived_at timestamptz;

update public.knowledge_documents document
set tenant_id = organization.tenant_id,
    owner_member_id = document.created_by_member_id
from public.organizations organization
where organization.id = document.organization_id;

alter table public.knowledge_documents
  alter column tenant_id set not null,
  alter column owner_member_id set not null,
  add constraint knowledge_documents_tenant_organization_id_key unique (tenant_id,organization_id,id),
  add constraint knowledge_documents_exact_organization_fkey foreign key (tenant_id,organization_id)
    references public.organizations(tenant_id,id) on delete cascade,
  add constraint knowledge_documents_owner_tenant_fkey foreign key (tenant_id,owner_member_id)
    references public.organization_members(tenant_id,id) on delete restrict,
  add constraint knowledge_documents_owner_organization_fkey foreign key (organization_id,owner_member_id)
    references public.organization_members(organization_id,id) on delete restrict;

create table public.knowledge_directories (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  parent_id bigint,
  name text not null check (length(btrim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  created_by_member_id bigint not null,
  archived_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id,organization_id,id),
  unique (tenant_id,organization_id,parent_id,slug) nulls not distinct,
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,parent_id)
    references public.knowledge_directories(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,created_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  foreign key (organization_id,created_by_member_id) references public.organization_members(organization_id,id) on delete restrict
);

alter table public.knowledge_documents add column directory_id bigint;
alter table public.knowledge_documents add constraint knowledge_documents_directory_fkey
  foreign key (tenant_id,organization_id,directory_id)
  references public.knowledge_directories(tenant_id,organization_id,id) on delete restrict;

create table public.knowledge_document_versions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  document_id bigint not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft','published','superseded','archived')),
  title text not null check (length(btrim(title)) between 1 and 200),
  summary text not null default '' check (length(summary) <= 2000),
  extracted_text text not null default '' check (length(extracted_text) <= 5000000),
  source_file_id bigint,
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_member_id bigint not null,
  published_by_member_id bigint,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  search_vector tsvector generated always as (
    to_tsvector('simple',coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(extracted_text,''))
  ) stored,
  unique (tenant_id,organization_id,id),
  unique (tenant_id,document_id,version_number),
  foreign key (tenant_id,organization_id,document_id)
    references public.knowledge_documents(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,source_file_id)
    references public.files(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,created_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  foreign key (organization_id,created_by_member_id) references public.organization_members(organization_id,id) on delete restrict,
  foreign key (tenant_id,published_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  constraint knowledge_version_publication_check check (
    (status = 'published' and published_at is not null and published_by_member_id is not null)
    or status <> 'published'
  )
);

alter table public.knowledge_documents add column current_version_id bigint;
alter table public.knowledge_documents add constraint knowledge_documents_current_version_fkey
  foreign key (tenant_id,organization_id,current_version_id)
  references public.knowledge_document_versions(tenant_id,organization_id,id) on delete restrict;

create table public.knowledge_permissions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  document_id bigint,
  directory_id bigint,
  subject_type text not null check (subject_type in ('organization','member','department','role')),
  subject_id bigint not null,
  permission text not null check (permission in ('read','manage')),
  granted_by_member_id bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  check (num_nonnulls(document_id,directory_id) = 1),
  unique (tenant_id,organization_id,document_id,directory_id,subject_type,subject_id,permission) nulls not distinct,
  foreign key (tenant_id,organization_id,document_id)
    references public.knowledge_documents(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,directory_id)
    references public.knowledge_directories(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,granted_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  foreign key (organization_id,granted_by_member_id) references public.organization_members(organization_id,id) on delete restrict
);

create table public.knowledge_sources (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  document_id bigint not null,
  version_id bigint not null,
  file_id bigint not null,
  page_from integer check (page_from is null or page_from > 0),
  page_to integer check (page_to is null or page_to >= page_from),
  character_from integer check (character_from is null or character_from >= 0),
  character_to integer check (character_to is null or character_to >= character_from),
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id,organization_id,id),
  foreign key (tenant_id,organization_id,document_id)
    references public.knowledge_documents(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,version_id)
    references public.knowledge_document_versions(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,file_id)
    references public.files(tenant_id,organization_id,id) on delete restrict
);

create index knowledge_versions_search_idx on public.knowledge_document_versions using gin(search_vector);
create index knowledge_versions_document_idx on public.knowledge_document_versions(tenant_id,document_id,version_number desc);
create index knowledge_permissions_document_idx on public.knowledge_permissions(tenant_id,organization_id,document_id);

create or replace function public.reject_published_knowledge_version_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.status = 'published' then
    raise exception 'Published knowledge versions are immutable' using errcode='55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger knowledge_versions_immutable
before update or delete on public.knowledge_document_versions
for each row execute function public.reject_published_knowledge_version_mutation();

create or replace function public.can_access_knowledge_document(p_document_id bigint,p_manage boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1
    from public.knowledge_documents document
    join public.organization_members actor
      on actor.tenant_id=document.tenant_id and actor.organization_id=document.organization_id
     and actor.user_id=(select auth.uid()) and actor.status='active'
    where document.id=p_document_id and document.archived_at is null
      and document.tenant_id=(select public.current_tenant_id())
      and (
        (p_manage and (select public.has_organization_permission(document.organization_id,'knowledge.manage')))
        or actor.id=document.owner_member_id
        or (
          not p_manage and document.status='published' and document.current_version_id is not null and (
            not exists (
              select 1 from public.knowledge_permissions restriction
              where restriction.tenant_id=document.tenant_id
                and (restriction.document_id=document.id or restriction.directory_id=document.directory_id)
            )
            or exists (
              select 1 from public.knowledge_permissions permission
              where permission.tenant_id=document.tenant_id
                and permission.organization_id=document.organization_id
                and (permission.document_id=document.id or permission.directory_id=document.directory_id)
                and permission.permission in ('read','manage')
                and (
                  (permission.subject_type='organization' and permission.subject_id=document.organization_id)
                  or (permission.subject_type='member' and permission.subject_id=actor.id)
                  or (permission.subject_type='role' and exists (
                    select 1 from public.member_roles assignment
                    join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id and role.is_enabled
                    where assignment.tenant_id=actor.tenant_id and assignment.member_id=actor.id
                      and role.id=permission.subject_id
                      and (role.organization_id is null or role.organization_id=document.organization_id)
                  ))
                  or (permission.subject_type='department' and exists (
                    select 1 from public.employee_profiles profile
                    where profile.tenant_id=actor.tenant_id and profile.organization_id=actor.organization_id
                      and profile.organization_member_id=actor.id and profile.department_id=permission.subject_id
                      and profile.deleted_at is null
                  ))
                )
            )
          )
        )
      )
  );
$$;

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_documents force row level security;
alter table public.knowledge_directories enable row level security;
alter table public.knowledge_directories force row level security;
alter table public.knowledge_document_versions enable row level security;
alter table public.knowledge_document_versions force row level security;
alter table public.knowledge_permissions enable row level security;
alter table public.knowledge_permissions force row level security;
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_sources force row level security;

drop policy if exists professional_member_read_knowledge on public.knowledge_documents;
drop policy if exists professional_member_create_knowledge on public.knowledge_documents;
drop policy if exists professional_owner_publish_knowledge on public.knowledge_documents;
create policy knowledge_document_access on public.knowledge_documents for select to authenticated
  using (public.can_access_knowledge_document(id,false) or public.can_access_knowledge_document(id,true));
create policy knowledge_directory_member_access on public.knowledge_directories for select to authenticated
  using (tenant_id=(select public.current_tenant_id()) and public.is_organization_member(organization_id));
create policy knowledge_version_access on public.knowledge_document_versions for select to authenticated
  using (public.can_access_knowledge_document(document_id,false) or public.can_access_knowledge_document(document_id,true));
create policy knowledge_permission_manager_access on public.knowledge_permissions for select to authenticated
  using ((select public.has_organization_permission(organization_id,'knowledge.manage')));
create policy knowledge_source_access on public.knowledge_sources for select to authenticated
  using (public.can_access_knowledge_document(document_id,false) or public.can_access_knowledge_document(document_id,true));

revoke all on function public.reject_published_knowledge_version_mutation() from public,anon,authenticated,service_role;
revoke all on function public.can_access_knowledge_document(bigint,boolean) from public,anon;
grant execute on function public.can_access_knowledge_document(bigint,boolean) to authenticated,service_role;
grant select on public.knowledge_documents,public.knowledge_directories,public.knowledge_document_versions,
  public.knowledge_permissions,public.knowledge_sources to authenticated;

commit;
