-- Validate before reporting success. Never repair unknown ownership with broad grants.
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM pg_namespace
        WHERE (nspname = 'app' AND pg_get_userbyid(nspowner) = 'app_user')
           OR (nspname = 'agent_runtime' AND pg_get_userbyid(nspowner) = 'agent_user')) <> 2 THEN
        RAISE EXCEPTION 'Restored schemas must retain their service-role owners';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname IN ('app', 'agent_runtime')
          AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
          AND pg_get_userbyid(relation.relowner) <>
              CASE namespace.nspname WHEN 'app' THEN 'app_user' ELSE 'agent_user' END
    ) THEN
        RAISE EXCEPTION 'Restored tables, views and sequences must retain their service-role owners';
    END IF;

    IF has_schema_privilege('app_user', 'agent_runtime', 'USAGE')
       OR has_schema_privilege('agent_user', 'app', 'USAGE') THEN
        RAISE EXCEPTION 'Restored service roles must remain isolated across schemas';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM app.flyway_schema_history WHERE success = TRUE)
       OR EXISTS (SELECT 1 FROM app.flyway_schema_history WHERE success = FALSE) THEN
        RAISE EXCEPTION 'Restored Flyway history is empty or contains failed migrations';
    END IF;
END $$;

SELECT COUNT(*) AS successful_migrations FROM app.flyway_schema_history WHERE success = TRUE;
