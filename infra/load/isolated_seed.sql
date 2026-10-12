-- Synthetic quotation fixture for a disposable PostgreSQL database only.
-- Create the user/workspace/client/projects through the real Spring API first.
-- Usage (repeat with a different empty project for 10, 100, and 1000):
-- psql "$ISOLATED_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--   -v isolated_test=true -v workspace_id="$WORKSPACE_ID" \
--   -v user_id="$USER_ID" -v project_id="$PROJECT_ID" \
--   -v quotation_count=100 -f infra/load/isolated_seed.sql
-- Optional: -v explain=true prints four representative SELECT execution plans.
--
-- Required database name: isolated_load (or isolated_load_<run identifier>).
-- Required workspace name prefix: Isolated load
-- Adds N independent draft quotations, 6N items, 3N assumptions, 3N evidence.
-- N=10: 10/60/30/30; N=100: 100/600/300/300; N=1000: 1000/6000/3000/3000.
-- Running all three projects adds 1110/6660/3330/3330 rows respectively.
-- No existing rows are deleted or replaced. Rerunning against a populated
-- project fails and rolls back. No credentials, provider calls, or real data.

\set ON_ERROR_STOP on
\if :{?isolated_test}
\else
  \echo 'Required: -v isolated_test=true'
  \quit 3
\endif
\if :{?workspace_id}
\else
  \echo 'Required: -v workspace_id=<API-created workspace UUID>'
  \quit 3
\endif
\if :{?user_id}
\else
  \echo 'Required: -v user_id=<API-registered user UUID>'
  \quit 3
\endif
\if :{?project_id}
\else
  \echo 'Required: -v project_id=<API-created empty project UUID>'
  \quit 3
\endif
\if :{?quotation_count}
\else
  \echo 'Required: -v quotation_count=10|100|1000'
  \quit 3
\endif
\if :{?explain}
\else
  \set explain false
\endif

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE isolated_load_parameters (
    isolated_test boolean NOT NULL CHECK (isolated_test),
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    quotation_count integer NOT NULL CHECK (quotation_count IN (10, 100, 1000))
) ON COMMIT DROP;
INSERT INTO isolated_load_parameters VALUES (
    :'isolated_test'::boolean, :'workspace_id'::uuid, :'user_id'::uuid,
    :'project_id'::uuid, :'quotation_count'::integer
);

DO $fixture_guard$
DECLARE p isolated_load_parameters%ROWTYPE;
BEGIN
    SELECT * INTO STRICT p FROM isolated_load_parameters;
    IF current_database() !~ '^isolated_load(_[a-zA-Z0-9_]+)?$' THEN
        RAISE EXCEPTION 'Fixture requires database isolated_load or isolated_load_<run identifier>';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM app.workspace w
        JOIN app.workspace_member m ON m.workspace_id = w.id
        JOIN app.user_account u ON u.id = m.user_id
        JOIN app.project pr ON pr.workspace_id = w.id
        WHERE w.id = p.workspace_id AND w.name LIKE 'Isolated load%'
          AND w.status = 'ACTIVE' AND w.created_by = p.user_id
          AND m.user_id = p.user_id AND m.status = 'ACTIVE'
          AND u.status = 'ACTIVE' AND u.password_hash IS NOT NULL
          AND pr.id = p.project_id AND pr.created_by = p.user_id
    ) THEN
        RAISE EXCEPTION 'API-created active synthetic workspace/user/project ownership check failed';
    END IF;
    -- Serialize fixture invocations for this project without touching other projects.
    PERFORM 1 FROM app.project WHERE id = p.project_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM app.quotation WHERE project_id = p.project_id) THEN
        RAISE EXCEPTION 'Target project is not empty; use a fresh project (nothing is deleted)';
    END IF;
END
$fixture_guard$;

-- Fixed timestamps and deterministic, project-scoped IDs make fixture shape
-- reproducible. Separate series avoid synthetic previous-version shortcuts.
CREATE TEMP TABLE isolated_load_quotes ON COMMIT DROP AS
SELECT p.workspace_id, p.user_id, p.project_id, n AS ordinal,
       md5(p.project_id::text || ':isolated-load:quotation:' || n)::uuid AS id,
       pr.currency,
       (125 + (n % 5) * 10)::numeric(19, 2) AS unit_rate,
       TIMESTAMPTZ '2026-01-01 00:00:00+00' + n * INTERVAL '1 minute' AS created_at
FROM isolated_load_parameters p
JOIN app.project pr ON pr.id = p.project_id AND pr.workspace_id = p.workspace_id
CROSS JOIN LATERAL generate_series(1, p.quotation_count) AS n;

INSERT INTO app.quotation (
    id, workspace_id, project_id, series_id, previous_version_id, version_number,
    scenario, status, currency, subtotal, discount_total, risk_buffer_rate,
    risk_buffer_amount, tax_rate, tax_amount, total, valid_until,
    published_at, published_by, created_by, created_at, updated_at, version
)
SELECT id, workspace_id, project_id, id, NULL, 1,
       (ARRAY['LEAN', 'RECOMMENDED', 'EXPANDED'])[1 + ((ordinal - 1) % 3)],
       'DRAFT', currency, 42 * unit_rate, round(42 * unit_rate * 0.05, 2), 0.10,
       round(42 * unit_rate * 0.95 * 0.10, 2), 0.10,
       round(42 * unit_rate * 0.95 * 1.10 * 0.10, 2),
       round(42 * unit_rate * 0.95 * 1.10, 2)
         + round(42 * unit_rate * 0.95 * 1.10 * 0.10, 2),
       DATE '2027-01-01', NULL, NULL, user_id, created_at, created_at, 0
FROM isolated_load_quotes;

CREATE TEMP TABLE isolated_load_items ON COMMIT DROP AS
SELECT q.*, i AS item_number,
       md5(q.id::text || ':item:' || i)::uuid AS item_id,
       md5(q.id::text || ':basis:' || i)::uuid AS basis_id,
       (ARRAY[
         'Discovery and scope', 'Data model and migrations', 'API implementation',
         'Client interface', 'Verification and accessibility', 'Handover documentation'
       ])[i] AS item_title
FROM isolated_load_quotes q CROSS JOIN generate_series(1, 6) AS i;

INSERT INTO app.quotation_assumption (id, workspace_id, quotation_id, content, created_at)
SELECT basis_id, workspace_id, id,
       'SYNTHETIC LOAD FIXTURE: ' || item_title || ' assumes one review round, a supplied '
       || 'design brief, and no external integrations. This is generated benchmark content '
       || 'for quotation ' || ordinal || ', item ' || item_number || ', not a customer estimate.',
       created_at
FROM isolated_load_items WHERE item_number % 2 = 1;

INSERT INTO app.quotation_evidence (
    id, workspace_id, quotation_id, source_type, source_reference,
    title, excerpt, retrieved_at, created_at
)
SELECT basis_id, workspace_id, id, 'USER_TEMPLATE',
       'urn:synthetic:isolated-load:' || project_id || ':' || ordinal || ':' || item_number,
       'Synthetic delivery template: ' || item_title,
       'SYNTHETIC LOAD FIXTURE: Generated delivery template allocates ' || (item_number * 2)
       || ' hours for ' || lower(item_title) || '. Includes implementation, one review cycle, '
       || 'and handover. This evidence is invented benchmark data and has no external source.',
       created_at - INTERVAL '1 day', created_at
FROM isolated_load_items WHERE item_number % 2 = 0;

INSERT INTO app.quotation_item (
    id, workspace_id, quotation_id, rate_card_id, title, description, quantity,
    unit, unit_rate, subtotal, discount_rate, discount_amount, total,
    assumption_id, evidence_id, sort_order, created_at
)
SELECT item_id, workspace_id, id, NULL, item_title,
       'Synthetic bounded delivery work package ' || item_number
       || ': implementation, review, and documented acceptance checks.',
       item_number * 2, 'HOUR', unit_rate, item_number * 2 * unit_rate,
       0.05, round(item_number * 2 * unit_rate * 0.05, 2),
       item_number * 2 * unit_rate - round(item_number * 2 * unit_rate * 0.05, 2),
       CASE WHEN item_number % 2 = 1 THEN basis_id END,
       CASE WHEN item_number % 2 = 0 THEN basis_id END,
       item_number - 1, created_at
FROM isolated_load_items;

-- Assertions run before COMMIT: any count, linkage, or arithmetic mismatch
-- aborts the entire fixture. PostgreSQL's real FK/check/unique constraints stay on.
DO $fixture_assertions$
DECLARE
    p isolated_load_parameters%ROWTYPE;
    quotes bigint;
    items bigint;
    assumptions bigint;
    evidence bigint;
BEGIN
    SELECT * INTO STRICT p FROM isolated_load_parameters;
    SELECT count(*) INTO quotes FROM app.quotation WHERE project_id = p.project_id;
    SELECT count(*) INTO items FROM app.quotation_item i
        JOIN app.quotation q ON q.id = i.quotation_id WHERE q.project_id = p.project_id;
    SELECT count(*) INTO assumptions FROM app.quotation_assumption a
        JOIN app.quotation q ON q.id = a.quotation_id WHERE q.project_id = p.project_id;
    SELECT count(*) INTO evidence FROM app.quotation_evidence e
        JOIN app.quotation q ON q.id = e.quotation_id WHERE q.project_id = p.project_id;
    IF quotes <> p.quotation_count OR items <> 6 * p.quotation_count
       OR assumptions <> 3 * p.quotation_count OR evidence <> 3 * p.quotation_count THEN
        RAISE EXCEPTION 'Cardinality mismatch: quotes %, items %, assumptions %, evidence %',
            quotes, items, assumptions, evidence;
    END IF;
    IF EXISTS (
        SELECT 1 FROM app.quotation q
        JOIN app.quotation_item i ON i.quotation_id = q.id
        WHERE q.project_id = p.project_id
        GROUP BY q.id
        HAVING count(*) <> 6 OR count(i.assumption_id) <> 3 OR count(i.evidence_id) <> 3
           OR min(i.sort_order) <> 0 OR max(i.sort_order) <> 5
           OR count(DISTINCT i.sort_order) <> 6
           OR sum(i.subtotal) <> q.subtotal OR sum(i.discount_amount) <> q.discount_total
           OR round(sum(i.total) * q.risk_buffer_rate, 2) <> q.risk_buffer_amount
           OR round((sum(i.total) + q.risk_buffer_amount) * q.tax_rate, 2) <> q.tax_amount
           OR sum(i.total) + q.risk_buffer_amount + q.tax_amount <> q.total
    ) THEN
        RAISE EXCEPTION 'Per-quotation item/basis count, order, or money consistency failed';
    END IF;
    RAISE NOTICE 'Fixture verified: quotations=%, items=%, assumptions=%, evidence=%',
        quotes, items, assumptions, evidence;
END
$fixture_assertions$;

ANALYZE app.quotation;
ANALYZE app.quotation_item;
ANALYZE app.quotation_assumption;
ANALYZE app.quotation_evidence;
COMMIT;

SELECT current_database() AS database_name, :'project_id'::uuid AS project_id,
       count(*) AS quotations, count(*) * 6 AS expected_items,
       count(*) * 3 AS expected_assumptions, count(*) * 3 AS expected_evidence
FROM app.quotation
WHERE workspace_id = :'workspace_id'::uuid AND project_id = :'project_id'::uuid;

-- This optional query-plan probe is diagnostic only. It is not an endpoint
-- benchmark and does not include RBAC queries, network, ORM, or JSON work.
-- Run it before the HTTP warmup, never inside a measured pg_stat_statements window.
\if :explain
  SELECT id AS probe_quotation_id FROM app.quotation
  WHERE workspace_id = :'workspace_id'::uuid AND project_id = :'project_id'::uuid
  ORDER BY created_at DESC LIMIT 1 \gset

  EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
  SELECT * FROM app.quotation
  WHERE workspace_id = :'workspace_id'::uuid AND project_id = :'project_id'::uuid
  ORDER BY created_at DESC;

  EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
  SELECT * FROM app.quotation_item
  WHERE workspace_id = :'workspace_id'::uuid AND quotation_id = :'probe_quotation_id'::uuid
  ORDER BY sort_order;

  EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
  SELECT * FROM app.quotation_assumption
  WHERE workspace_id = :'workspace_id'::uuid AND quotation_id = :'probe_quotation_id'::uuid;

  EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
  SELECT * FROM app.quotation_evidence
  WHERE workspace_id = :'workspace_id'::uuid AND quotation_id = :'probe_quotation_id'::uuid;
\endif
