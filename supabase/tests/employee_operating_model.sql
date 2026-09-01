begin;
select no_plan();

select has_table('public','project_sop_definitions');
select has_table('public','project_sop_versions');
select has_table('public','project_sop_runs');
select has_table('public','project_sop_run_events');
select has_table('public','project_decisions');
select has_table('public','project_retrospectives');

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid=any(array[
     'public.project_sop_definitions'::regclass,
     'public.project_sop_versions'::regclass,
     'public.project_sop_runs'::regclass,
     'public.project_sop_run_events'::regclass,
     'public.project_decisions'::regclass,
     'public.project_retrospectives'::regclass
   ])),
  'employee operating model tables enable and force RLS'
);

select policies_are('public','project_sop_definitions',array['project_sop_definitions_project_read']);
select policies_are('public','project_sop_versions',array['project_sop_versions_project_read']);
select policies_are('public','project_sop_runs',array['project_sop_runs_project_read']);
select policies_are('public','project_sop_run_events',array['project_sop_run_events_project_read']);
select policies_are('public','project_decisions',array['project_decisions_project_read']);
select policies_are('public','project_retrospectives',array['project_retrospectives_project_read']);

select ok(
  (select bool_and(
    has_table_privilege('authenticated',table_name,'SELECT')
    and not has_table_privilege('authenticated',table_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_table_privilege('anon',table_name,'SELECT,INSERT,UPDATE,DELETE')
  ))
  from unnest(array[
    'public.project_sop_definitions',
    'public.project_sop_versions',
    'public.project_sop_runs',
    'public.project_sop_run_events',
    'public.project_decisions',
    'public.project_retrospectives'
  ]) as scoped_tables(table_name),
  'browser roles can only read through RLS and cannot mutate operating model tables directly'
);

select has_trigger('public','project_sop_run_events','project_sop_run_events_append_only');
select has_trigger('public','project_sop_versions','project_sop_versions_published_immutable');

select has_function('public','save_current_project_sop',array['uuid','uuid','text','text','text','jsonb','boolean','text','uuid','uuid']);
select has_function('public','start_current_project_sop_run',array['uuid','uuid','uuid','uuid','text','uuid','uuid']);
select has_function('public','advance_current_project_sop_run',array['uuid','text','bigint','text','jsonb','text','uuid','uuid']);
select has_function('public','record_current_project_decision',array['uuid','text','text','text','jsonb','uuid','text','uuid','uuid']);
select has_function('public','transition_current_project_decision',array['uuid','text','bigint','text','uuid','uuid']);
select has_function('public','save_current_project_retrospective',array['uuid','text','text','text','text','bigint','text','uuid','uuid']);
select has_function('public','update_current_project_risk_status',array['uuid','text','bigint','text','uuid','uuid']);
select has_function('public','current_project_operating_model',array['uuid','integer']);
select has_function('public','current_employee_capability_center',array['uuid','uuid','integer']);

select ok(
  has_function_privilege('authenticated','public.save_current_project_sop(uuid,uuid,text,text,text,jsonb,boolean,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.start_current_project_sop_run(uuid,uuid,uuid,uuid,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.advance_current_project_sop_run(uuid,text,bigint,text,jsonb,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.record_current_project_decision(uuid,text,text,text,jsonb,uuid,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.transition_current_project_decision(uuid,text,bigint,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.save_current_project_retrospective(uuid,text,text,text,text,bigint,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.update_current_project_risk_status(uuid,text,bigint,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.save_current_project_sop(uuid,uuid,text,text,text,jsonb,boolean,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.save_current_project_sop(uuid,uuid,text,text,text,jsonb,boolean,text,uuid,uuid)','EXECUTE'),
  'writes are available only through authenticated command RPCs'
);

select ok(
  has_function_privilege('authenticated','public.current_project_operating_model(uuid,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.current_employee_capability_center(uuid,uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.current_project_operating_model(uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.current_employee_capability_center(uuid,uuid,integer)','EXECUTE'),
  'operating model read projections require an authenticated employee'
);

select ok(
  not has_function_privilege('authenticated','public.valid_project_sop_steps(jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.valid_project_decision_citations(jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.reject_operating_model_history_mutation()','EXECUTE')
  and not has_function_privilege('authenticated','public.reject_published_project_sop_version_mutation()','EXECUTE'),
  'internal validation and immutability helpers are not exposed'
);

select * from finish();
rollback;
