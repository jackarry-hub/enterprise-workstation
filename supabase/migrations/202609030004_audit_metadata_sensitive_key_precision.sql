begin;

-- Business identifiers such as errorCode, roleCode and providerCode are safe
-- audit dimensions. Continue rejecting keys that can carry credentials,
-- session material or one-time authorization data.
create or replace function public.jsonb_has_sensitive_key(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_normalized_key text;
  v_child jsonb;
begin
  if p_value is null then
    return false;
  end if;
  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      v_normalized_key := regexp_replace(lower(v_key), '[^a-z0-9]+', '', 'g');
      if v_normalized_key ~ '(token|secret|authorization|cookie|servicerole|password|passphrase|privatekey|apikey|oauth|otp|verificationcode|onetimecode|resetcode|invitecode|accesscode|authcode|codeverifier)' then
        return true;
      end if;
      if public.jsonb_has_sensitive_key(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if public.jsonb_has_sensitive_key(v_child) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

revoke all on function public.jsonb_has_sensitive_key(jsonb)
  from public, anon, authenticated, service_role;

commit;
