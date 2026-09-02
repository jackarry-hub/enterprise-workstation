begin;

-- The audit ledger has always exposed target_type/target_id. The original AI
-- conversation function referenced obsolete resource_* column names, so the
-- first conversation could not be created in a fully migrated database.
create or replace function public.create_ai_conversation(
  p_title text,
  p_idempotency_key uuid,
  p_request_id uuid
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
  if length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or p_idempotency_key is null
     or p_request_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select * into v_actor from public.current_ai_conversation_actor();
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_actor.tenant_id::text || ':' || v_actor.member_id::text || ':conversation:' || p_idempotency_key::text,
    0
  ));

  select conversation.*
    into v_conversation
    from public.ai_conversations conversation
    join public.audit_logs audit
      on audit.tenant_id = conversation.tenant_id
     and audit.organization_id = conversation.organization_id
     and audit.target_type = 'ai_conversation'
     and audit.target_id = conversation.public_id::text
     and audit.request_id = p_idempotency_key
   where conversation.tenant_id = v_actor.tenant_id
     and conversation.owner_member_id = v_actor.member_id
   limit 1;

  if not found then
    insert into public.ai_conversations (
      tenant_id, organization_id, owner_member_id, title
    ) values (
      v_actor.tenant_id, v_actor.organization_id, v_actor.member_id, btrim(p_title)
    ) returning * into v_conversation;

    perform public.append_audit_log(
      v_actor.tenant_id,
      v_actor.organization_id,
      v_actor.user_id,
      v_actor.member_id,
      'ai.conversation.created',
      'ai_conversation',
      v_conversation.public_id::text,
      p_idempotency_key,
      null,
      jsonb_build_object('requestId', p_request_id)
    );
  elsif v_conversation.title <> btrim(p_title) then
    raise exception 'idempotency_conflict' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', v_conversation.public_id,
      'title', v_conversation.title,
      'version', v_conversation.version,
      'lastMessageAt', v_conversation.last_message_at
    )
  );
end;
$$;

revoke all on function public.create_ai_conversation(text, uuid, uuid)
  from public, anon;
grant execute on function public.create_ai_conversation(text, uuid, uuid)
  to authenticated;

commit;
