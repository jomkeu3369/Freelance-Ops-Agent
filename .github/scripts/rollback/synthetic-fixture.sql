-- CI-only synthetic identities and quotations. Never run against an existing database.
INSERT INTO app.user_account(id, external_subject, email, status)
VALUES ('10000000-0000-0000-0000-000000000001', 'rollback-fixture', 'rollback@example.invalid', 'ACTIVE');
INSERT INTO app.workspace(id, name, slug, status, created_by)
VALUES ('20000000-0000-0000-0000-000000000001', 'Synthetic rollback fixture', 'rollback-fixture', 'ACTIVE', '10000000-0000-0000-0000-000000000001');
INSERT INTO app.workspace_member(id, workspace_id, user_id, status, joined_at)
VALUES ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'ACTIVE', CURRENT_TIMESTAMP);
INSERT INTO app.workspace_role(id, workspace_id, code, display_name)
VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'READER', 'Synthetic quotation reader');
INSERT INTO app.role_permission(workspace_id, role_id, permission_code)
SELECT '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', code
FROM app.permission WHERE code IN ('quotation.read', 'project.read');
INSERT INTO app.member_role(workspace_id, membership_id, role_id, assigned_by)
VALUES ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
INSERT INTO app.project(id, workspace_id, title, requirement_text, currency, status, created_by)
SELECT ('50000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '20000000-0000-0000-0000-000000000001', 'Synthetic rollback project ' || n,
       'Synthetic only. No agent execution.', 'KRW', 'LEAD', '10000000-0000-0000-0000-000000000001'
FROM generate_series(1, 3) n;
INSERT INTO app.quotation(id, workspace_id, project_id, series_id, version_number, scenario, status, currency,
                          subtotal, discount_total, risk_buffer_rate, risk_buffer_amount, tax_rate, tax_amount,
                          total, created_by, created_at, updated_at)
SELECT id, '20000000-0000-0000-0000-000000000001', project_id, id, 1, 'RECOMMENDED', 'DRAFT', 'KRW',
       200, 0, 0, 0, 0, 0, 200, '10000000-0000-0000-0000-000000000001',
       '2026-10-01T00:00:00.123456Z', '2026-10-01T00:00:00.123456Z'
FROM (
    SELECT gen_random_uuid() id, '50000000-0000-0000-0000-000000000002'::uuid project_id
    UNION ALL
    SELECT gen_random_uuid(), '50000000-0000-0000-0000-000000000003'::uuid FROM generate_series(1, 101)
) fixture;
INSERT INTO app.quotation_assumption(id, workspace_id, quotation_id, content, created_at)
SELECT gen_random_uuid(), workspace_id, id, 'assumption:' || id, created_at FROM app.quotation;
INSERT INTO app.quotation_evidence(id, workspace_id, quotation_id, source_type, source_reference, title, excerpt, retrieved_at, created_at)
SELECT gen_random_uuid(), workspace_id, id, 'USER_TEMPLATE', 'fixture:' || id, 'Synthetic', 'evidence:' || id, created_at, created_at
FROM app.quotation;
INSERT INTO app.quotation_item(id, workspace_id, quotation_id, title, quantity, unit, unit_rate, subtotal,
                              discount_rate, discount_amount, total, assumption_id, evidence_id, sort_order, created_at)
SELECT gen_random_uuid(), q.workspace_id, q.id, 'Assumption item', 1, 'FIXED', 100, 100, 0, 0, 100, a.id, null, 0, q.created_at
FROM app.quotation q JOIN app.quotation_assumption a ON a.quotation_id = q.id;
INSERT INTO app.quotation_item(id, workspace_id, quotation_id, title, quantity, unit, unit_rate, subtotal,
                              discount_rate, discount_amount, total, assumption_id, evidence_id, sort_order, created_at)
SELECT gen_random_uuid(), q.workspace_id, q.id, 'Evidence item', 1, 'FIXED', 100, 100, 0, 0, 100, null, e.id, 1, q.created_at
FROM app.quotation q JOIN app.quotation_evidence e ON e.quotation_id = q.id;
