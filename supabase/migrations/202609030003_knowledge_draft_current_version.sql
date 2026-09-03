create or replace function public.sync_knowledge_draft_current_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.knowledge_documents document
  set current_version_id = new.id,
      version = new.version_number,
      updated_at = clock_timestamp()
  where document.tenant_id = new.tenant_id
    and document.organization_id = new.organization_id
    and document.id = new.document_id
    and document.status = 'draft'
    and document.current_version_id is null;

  return new;
end;
$$;

drop trigger if exists knowledge_draft_current_version_after_insert
  on public.knowledge_document_versions;

create trigger knowledge_draft_current_version_after_insert
after insert on public.knowledge_document_versions
for each row execute function public.sync_knowledge_draft_current_version();

with latest_draft as (
  select distinct on (version.tenant_id, version.organization_id, version.document_id)
    version.tenant_id,
    version.organization_id,
    version.document_id,
    version.id,
    version.version_number
  from public.knowledge_document_versions version
  where version.status = 'draft'
  order by
    version.tenant_id,
    version.organization_id,
    version.document_id,
    version.version_number desc,
    version.id desc
)
update public.knowledge_documents document
set current_version_id = latest.id,
    version = latest.version_number,
    updated_at = clock_timestamp()
from latest_draft latest
where document.tenant_id = latest.tenant_id
  and document.organization_id = latest.organization_id
  and document.id = latest.document_id
  and document.status = 'draft'
  and document.current_version_id is null;

revoke all on function public.sync_knowledge_draft_current_version()
  from public, anon, authenticated, service_role;
