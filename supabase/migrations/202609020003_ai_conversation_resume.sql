begin;

alter table public.ai_conversations
  add column if not exists last_opened_at timestamptz;

with latest as (
  select distinct on (conversation.tenant_id, conversation.organization_id, conversation.owner_member_id)
    conversation.id
  from public.ai_conversations conversation
  where conversation.archived_at is null
  order by conversation.tenant_id, conversation.organization_id,
    conversation.owner_member_id, conversation.last_message_at desc, conversation.id desc
)
update public.ai_conversations conversation
set last_opened_at = conversation.last_message_at
from latest
where conversation.id = latest.id
  and conversation.last_opened_at is null;

alter table public.ai_conversations
  alter column last_opened_at set default clock_timestamp();

create index if not exists ai_conversations_owner_opened_idx
  on public.ai_conversations(
    tenant_id, organization_id, owner_member_id,
    last_opened_at desc nulls last, id desc
  ) where archived_at is null;

create or replace function public.list_current_ai_conversations(
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor record;
begin
  if p_limit not between 1 and 100 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;
  select * into v_actor from public.current_ai_conversation_actor();
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.public_id,
        'title', item.title,
        'version', item.version,
        'lastMessageAt', item.last_message_at,
        'lastOpenedAt', item.last_opened_at,
        'archivedAt', item.archived_at
      ) order by item.last_message_at desc, item.id desc)
      from (
        select * from public.ai_conversations
        where tenant_id = v_actor.tenant_id
          and organization_id = v_actor.organization_id
          and owner_member_id = v_actor.member_id
          and archived_at is null
        order by last_message_at desc, id desc
        limit p_limit
      ) item
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.touch_current_ai_conversation(
  p_conversation_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_conversation public.ai_conversations%rowtype;
begin
  if p_conversation_public_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into v_actor from public.current_ai_conversation_actor();
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.ai_conversations conversation
  set last_opened_at = clock_timestamp()
  where conversation.tenant_id = v_actor.tenant_id
    and conversation.organization_id = v_actor.organization_id
    and conversation.owner_member_id = v_actor.member_id
    and conversation.public_id = p_conversation_public_id
    and conversation.archived_at is null
  returning * into v_conversation;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'conversationId', v_conversation.public_id,
    'lastOpenedAt', v_conversation.last_opened_at
  );
end;
$$;

revoke all on function public.touch_current_ai_conversation(uuid)
  from public, anon;
grant execute on function public.touch_current_ai_conversation(uuid)
  to authenticated;

commit;
