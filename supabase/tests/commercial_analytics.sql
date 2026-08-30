begin;
select plan(5);

select has_function('public', 'current_commercial_metrics', array['date','date'], 'commercial analytics RPC exists');
select function_returns('public', 'current_commercial_metrics', array['date','date'], 'jsonb', 'commercial analytics returns jsonb');
select volatility_is('public', 'current_commercial_metrics', array['date','date'], 'stable', 'commercial analytics is read only');
select function_privs_are('public', 'current_commercial_metrics', array['date','date'], 'authenticated', array['EXECUTE'], 'authenticated may execute analytics');
select function_privs_are('public', 'current_commercial_metrics', array['date','date'], 'anon', array[]::text[], 'anonymous users cannot execute analytics');

select * from finish();
rollback;
