DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ritmo_app') THEN
    CREATE ROLE ritmo_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ritmo_app;
GRANT SELECT ON "Category", "Level", "Badge", "Reward" TO ritmo_app;

DO $$
DECLARE
  table_name text;
  owner_column text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['User','Session','Project','Activity','ActivityRevision','Occurrence','OccurrenceUnit','ProgressEntry','Completion','XpMovement','ActiveDay','UserBadge','UserReward'] LOOP
    owner_column := CASE WHEN table_name = 'User' THEN 'id' ELSE 'userId' END;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO ritmo_app', table_name);
    EXECUTE format('CREATE POLICY account_isolation ON %I TO ritmo_app USING (%I = nullif(current_setting(''app.user_id'', true), '''')::uuid) WITH CHECK (%I = nullif(current_setting(''app.user_id'', true), '''')::uuid)', table_name, owner_column, owner_column);
  END LOOP;
END $$;

CREATE POLICY login_email_lookup ON "User" FOR SELECT TO ritmo_app
USING (nullif(current_setting('app.user_id', true), '') IS NULL AND email = nullif(current_setting('app.auth_email', true), ''));
