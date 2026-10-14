#!/usr/bin/env python3
"""Exact-image rollback rehearsal on a new synthetic-only PG17 database.

No production identity, secrets, data, snapshot, network or database is used.
Public old images are required: there is no source/authentication fallback.
All model execution is absent; saved results are explicit test fixture data.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib import error, request
from uuid import uuid4

CANDIDATE = '116692fc81b0116e6c8209eb51ce89a9a151c48b'
OLD_BACKEND = '775b92c8dbaafbdd21438140d4238e39e1aa8ef1'
OLD_AGENT = '9a48b5d18672f02fdcb30269b1dffc3f0a414d24'
OLD_IMAGES = {
    'backend': 'ghcr.io/jomkeu3369/freelance-ops-backend@sha256:eaa06af3b6fc1b04430ef872fa1f290102faa4dc362a18dc6583381b8531e6d0',
    'agent': 'ghcr.io/jomkeu3369/freelance-ops-agent@sha256:d3429b0c281c0292489715225bb2ef0c95b6de4c168aeca9c67a85d1f8f56f69',
}
EVIDENCE = Path('rollback-evidence')
PREFIX = 'v52-rollback-' + os.environ.get('GITHUB_RUN_ID', str(os.getpid()))
NETWORK = PREFIX + '-internal'
DATABASE = PREFIX + '-pg17'
DB_NAME = 'rollback_synthetic'
CONTAINERS = []
REPORT = {'candidate_sha': CANDIDATE, 'old_backend_sha': OLD_BACKEND,
          'old_agent_sha': OLD_AGENT, 'cases': [], 'result': 'incomplete',
          'production_contacted': False, 'production_dump_used': False,
          'real_model_calls': 0, 'model_execution_double': 'persisted synthetic terminal results only',
          'font_present': False, 'required_pdf_ci_replaced_or_skipped': False,
          'candidate_deployment_approved_by_this_test': False,
          'scope': 'Completion/spend disabled; legacy compatible persisted scopes. No claim for completion-v1 activation or mixed-version execution.'}


def save(name, value):
    EVIDENCE.mkdir(exist_ok=True)
    (EVIDENCE / name).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def run(args, *, input=None, env=None, check=True, timeout=60):
    result = subprocess.run(args, input=input, env=env, text=True, capture_output=True, timeout=timeout)
    if check and result.returncode:
        # Never relay environment values, fixture bearer tokens or arbitrary output.
        raise RuntimeError(f'{Path(args[0]).name}_{args[1]}_exit_{result.returncode}')
    return result


def require(condition, name):
    if not condition:
        raise AssertionError(name)


def case(name, **facts):
    REPORT['cases'].append({'name': name, 'passed': True, **facts})
    save('summary.json', REPORT)
    print('PASS: ' + name, flush=True)


def validate_image_identity(service, image, facts):
    # Graphdriver .Id identifies the image config; containerd may expose the
    # target manifest digest instead. Match the exact production RepoDigest,
    # not these different engine-local ID representations.
    require(image in facts['repo_digests'], service + '_digest_matches_fresh_production')
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', facts['image_id']) is not None,
            service + '_local_image_id_shape')
    require(facts['architecture'] == 'amd64' and facts['os'] == 'linux', service + '_linux_amd64_image')


def resolve_images():
    selections = {}
    for service, image in OLD_IMAGES.items():
        with tempfile.TemporaryDirectory(prefix='v52-public-image-') as config:
            result = run(['docker', '--config', config, 'pull', image], check=False, timeout=300)
        selections[service] = {'image': image, 'anonymous_pull_succeeded': result.returncode == 0,
                               'credential_or_source_fallback_attempted': False}
        save('old-image-resolution.json', selections)
        require(result.returncode == 0, service + '_exact_public_image_unavailable_stop_no_fallback')
        facts = json.loads(run(['docker', 'image', 'inspect', '--format',
            '{"image_id":{{json .Id}},"repo_digests":{{json .RepoDigests}},"architecture":{{json .Architecture}},"os":{{json .Os}}}', image]).stdout)
        selections[service].update(facts)
        save('old-image-resolution.json', selections)
        validate_image_identity(service, image, facts)
    print('Both exact production images are anonymously readable; no authentication fallback.', flush=True)


def sql(statement, *, check=True):
    return run(['docker', 'exec', '-i', DATABASE, 'psql', '-X', '-qAt', '-v',
                'ON_ERROR_STOP=1', '-U', 'postgres', '-d', DB_NAME], input=statement, check=check)


def scalar(statement):
    return sql(statement).stdout.strip()


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def http(port, method, path, body=None, bearer=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {'Content-Type': 'application/json'}
    if bearer:
        headers['Authorization'] = 'Bearer ' + bearer
    req = request.Request(f'http://127.0.0.1:{port}' + path, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=10) as response:
            status, raw = response.status, response.read()
    except error.HTTPError as response:
        status, raw = response.code, response.read()
    return status, json.loads(raw) if raw else None


def expect(port, method, path, status, body=None, bearer=None):
    observed, value = http(port, method, path, body, bearer)
    require(observed == status, f'{method}_{path}_expected_{status}_received_{observed}')
    return value


def ready(name, port, path):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            code, body = http(port, 'GET', path)
            if code == 200 and body.get('status') == 'UP':
                save(name + '-readiness.json', {'http_status': code, 'status': 'UP'})
                return
        except (error.URLError, OSError, ValueError):
            pass
        require(run(['docker', 'inspect', '--format', '{{.State.Running}}', name]).stdout.strip() == 'true',
                name + '_exited_before_readiness')
        time.sleep(2)
    raise AssertionError(name + '_readiness_timeout')


def start(label, service, env, image, *, jar=None):
    name = PREFIX + '-' + label + '-' + service
    port = 18324 if service == 'backend' else 18325
    internal_port = 8080 if service == 'backend' else 8000
    args = ['docker', 'run', '-d', '--name', name, '--network', NETWORK,
            '--network-alias', service, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '-p', f'127.0.0.1:{port}:{internal_port}']
    for key in env:
        args += ['-e', key]
    if jar:
        args += ['--mount', f'type=bind,src={jar.resolve()},dst=/app/app.jar,readonly',
                 image, 'java', '-jar', '/app/app.jar']
    else:
        args += [image]
    CONTAINERS.append(name)
    run(args, env={**os.environ, **env})
    ready(name, port, '/actuator/health/readiness' if service == 'backend' else '/health/readiness')
    return name


def stop_pair(pair):
    # Stop only this harness's containers and keep the database continuously alive.
    for name in reversed(pair):
        run(['docker', 'stop', '--time', '30', name], timeout=60)
        run(['docker', 'network', 'disconnect', NETWORK, name])


def test_keys():
    # Same ephemeral RSA-2048 memory fixture as ConnectedWorkflowPostgresTest.testKeys;
    # no production auth/key is accessed, persisted or sent to a provider.
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_der = private.private_bytes(serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public_der = private.public_key().public_bytes(serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo)
    public_pem = private.public_key().public_bytes(serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    return private, base64.b64encode(private_der).decode(), base64.b64encode(public_der).decode(), public_pem


def delegated(private, ids, *, deadline=False, run_id=None):
    import jwt
    now = int(time.time())
    claims = {'iss': 'freelance-ops-backend', 'aud': 'freelance-ops-agent',
              'sub': ids['user'], 'jti': str(uuid4()), 'iat': now, 'exp': now + 60,
              'run_id': run_id or ids['run'], 'workspace_id': ids['workspace'],
              'project_id': ids['project'], 'initiated_by': ids['user'],
              'permissions': ['agent.run', 'agent.respond', 'agent.cancel', 'project.read', 'document.read']}
    if deadline:
        claims['execution_deadline'] = now + 60
    return jwt.encode(claims, private, algorithm='RS256', headers={'kid': 'freelance-ops-v1'})


def register_login():
    email = 'rollback-' + str(uuid4()) + '@example.invalid'
    password = 'Synthetic-test-password-23!'  # Existing connected workflow fixture.
    registered = expect(18324, 'POST', '/api/v2/auth/register', 201,
        {'email': email, 'password': password, 'displayName': '합성 사용자',
         'workspaceName': '격리 롤백 작업공간', 'ageAtLeast14': True})
    expect(18324, 'POST', '/api/v2/auth/login', 401, {'email': email, 'password': 'incorrect-password'})
    login = expect(18324, 'POST', '/api/v2/auth/login', 200, {'email': email, 'password': password})
    require(login['userId'] == registered['userId'] and login['workspaceId'] == registered['workspaceId'],
            'registration_login_identity_matches')
    expect(18324, 'GET', '/api/v2/me', 200, bearer=login['accessToken'])
    case('Real fixture registration and login; wrong password rejected')
    return login, email, password


def seed_saved_run(ids, status, *, with_source_columns):
    run_id = ids['run']
    request_body = {'context': {'runId': run_id, 'threadId': str(uuid4()), 'traceId': 'synthetic-only',
        'workspaceId': ids['workspace'], 'projectId': ids['project'], 'initiatedBy': ids['user'],
        'effectivePermissions': ['agent.run', 'project.read', 'document.read']},
        'budget': {'maxDurationSeconds': 180, 'maxModelCalls': 0, 'maxToolCalls': 0,
            'maxInputTokens': 0, 'maxOutputTokens': 0, 'maxDepartments': 4, 'maxHierarchyDepth': 1},
        'modelSelection': {'provider': 'OPENAI', 'model': 'gpt-6-luna', 'reasoningEffort': 'LOW'},
        'safetyContext': {}, 'input': {'requirementText': '합성 원문 요구사항', 'workflowMode': 'PROJECT_ANALYSIS'}}
    opinions = [{'scenario': scenario, 'items': [{'title': '합성 범위 ' + scenario,
        'quantity': 1, 'unit': 'DAY', 'basis': {'type': 'ASSUMPTION', 'content': '고객 확인 필요'}}],
        'petPerspective': {'proposal': '제안 ' + scenario, 'rationale': '근거 ' + scenario,
                           'tradeoff': '절충 ' + scenario}}
        for scenario in ('LEAN', 'RECOMMENDED', 'EXPANDED')]
    result = {'projectSummary': '합성 저장 결과', 'openQuestions': ['고객 확인 질문'],
              'departmentResults': [], 'quotationDraft': opinions[1], 'quotationDrafts': opinions}
    usage = {'requestTier': 'SINGLE_AGENT', 'modelCalls': 0, 'toolCalls': 0,
             'inputTokens': 0, 'outputTokens': 0, 'durationMs': 0, 'executionClosed': True}
    columns, source_values = ('', '')
    if with_source_columns:
        columns, source_values = ',source_project_version,workflow_mode', ",0,'PROJECT_ANALYSIS'"
    sql(f"INSERT INTO app.agent_run(id,workspace_id,project_id,thread_id,initiated_by,provider,model,status{columns}) "
        f"VALUES ({literal(run_id)},{literal(ids['workspace'])},{literal(ids['project'])},"
        f"{literal(request_body['context']['threadId'])},{literal(ids['user'])},'OPENAI','gpt-6-luna',{literal(status)}{source_values});")
    sql(f"INSERT INTO agent_runtime.agent_run_state(run_id,request_json,status,result_json,usage_json,idempotency_keys,updated_at) "
        f"VALUES ({literal(run_id)},{literal(json.dumps(request_body))}::jsonb,{literal(status)},"
        f"{literal(json.dumps(result))}::jsonb,{literal(json.dumps(usage))}::jsonb,'[]',now());")
    sql(f"INSERT INTO agent_runtime.agent_run_event(run_id,event_id,type,data_json,occurred_at) "
        f"VALUES ({literal(run_id)},1,'run.completed','{{}}',now());")
    return request_body


def schema_snapshot(label, expected_version):
    history = json.loads(scalar('SELECT json_agg(row_to_json(h) ORDER BY installed_rank) FROM app.flyway_schema_history h;'))
    applied = [row for row in history if row['version'] is not None]
    require(len(applied) == expected_version and all(x['success'] for x in applied)
            and {int(x['version']) for x in applied} == set(range(1, expected_version+1)),
            'exact_successful_flyway_history_' + str(expected_version))
    schema = run(['docker', 'exec', DATABASE, 'pg_dump', '--schema-only', '--schema=app',
        '--schema=agent_runtime', '--no-owner', '--no-privileges', '-U', 'postgres', '-d', DB_NAME]).stdout
    schema = '\n'.join(line for line in schema.splitlines()
                       if not line.startswith(('\\restrict ', '\\unrestrict ')))
    tables = ['source_message', 'platform_spend_reservation', 'platform_spend_settlement',
              'platform_provider_attempt', 'byok_provider_attempt']
    if expected_version == 52:
        tables += ['analysis_decision', 'specification', 'specification_request', 'document',
                   'document_chunk', 'platform_completion_reservation', 'platform_spend_month_entry']
    data = {table: json.loads(scalar(f"SELECT coalesce(json_agg(row_to_json(r) ORDER BY row_to_json(r)::text),'[]') FROM app.{table} r;"))
            for table in tables}
    runtime = {table: json.loads(scalar(f"SELECT coalesce(json_agg(row_to_json(r) ORDER BY row_to_json(r)::text),'[]') FROM agent_runtime.{table} r;"))
               for table in ('agent_run_state', 'agent_run_event')}
    result = {'flyway_history': history, 'schema_sha256': hashlib.sha256(schema.encode()).hexdigest(),
              'immutable_and_money_data': data, 'runtime_saved_data': runtime,
              'alembic_version': scalar('SELECT version_num FROM agent_runtime.alembic_version;')}
    save(label + '-snapshot.json', result)
    return result


def zero_execution():
    require(scalar('SELECT count(*) FROM app.platform_provider_attempt;') == '0', 'no_platform_provider_attempts')
    require(scalar('SELECT count(*) FROM app.byok_provider_attempt;') == '0', 'no_byok_provider_attempts')
    require(scalar("SELECT count(*) FROM app.agent_run_command WHERE status IN ('PENDING','PROCESSING');") == '0', 'no_dispatchable_commands')
    require(scalar("SELECT count(*) FROM agent_runtime.agent_run_state WHERE status IN ('QUEUED','RUNNING');") == '0', 'no_active_runtime_runs')


def api_artifacts(ids, bearer):
    base = f"/api/v2/workspaces/{ids['workspace']}/projects/{ids['project']}"
    sources = expect(18324, 'GET', base + '/analysis-decisions/sources/latest', 200, bearer=bearer)
    require(sources['runId'] == ids['run'], 'actual_source_run_matches_fixture')
    decision = expect(18324, 'POST', base + '/analysis-decisions', 200,
        {'requestId': str(uuid4()), 'sourceRunId': ids['run'], 'expectedProjectVersion': 0,
         'selectedOpinionIds': [ids['run'] + ':LEAN']}, bearer)
    decision = expect(18324, 'POST', base + '/analysis-decisions/' + decision['id'] + '/confirm', 200,
        {'expectedContentHash': decision['contentHash'], 'confirmation': 'CONFIRM_ANALYSIS_DECISION'}, bearer)
    spec = expect(18324, 'POST', base + '/specifications', 200,
        {'requestId': str(uuid4()), 'decisionId': decision['id']}, bearer)
    spec = expect(18324, 'POST', base + '/specifications/' + spec['id'] + '/confirm', 200,
        {'expectedContentHash': spec['contentHash'], 'confirmation': 'CONFIRM_SPECIFICATION'}, bearer)
    require(spec['status'] == 'CONFIRMED' and spec['indexStatus'] == 'KEYWORD_ONLY', 'confirmed_keyword_snapshot')
    case('Candidate actual HTTP analysis/specification confirmation and final-only document')
    # Missing remote font is a known release gate, not a skipped passing PDF test.
    expect(18324, 'GET', base + '/specifications/' + spec['id'] + '/pdf', 503, bearer=bearer)
    require(expect(18324, 'GET', base + '/specifications/' + spec['id'], 200, bearer=bearer)['contentHash'] == spec['contentHash'],
            'missing_font_keeps_confirmed_artifact')
    case('Missing-font HTTP503 preserves confirmed artifact; full PDF CI remains unresolved')
    return spec


def seed_conservative_liability(ids):
    monetary_run = str(uuid4())
    sql(f"INSERT INTO app.platform_spend_reservation(run_id,user_id,provider,model,max_cost_usd,tariff_version,day_period,week_period,valid_until) "
        f"VALUES ({literal(monetary_run)},{literal(ids['user'])},'OPENAI','gpt-6-luna',0.10,'synthetic-only',current_date,current_date,now()+interval '1 hour'); "
        f"INSERT INTO app.platform_spend_settlement(run_id,settled_usd,reserved_usd,execution_closed) VALUES ({literal(monetary_run)},0.03,0.07,false);")
    require(scalar('SELECT completion_required FROM app.platform_spend_settings WHERE id=1;') == 'f', 'completion_fence_remains_disabled')
    require(scalar('SELECT count(*) FROM app.platform_spend_month_entry;') == '1', 'month_liability_fixture_created')
    case('V49 accepts legacy reservation while completion remains disabled and conserves monthly liability', fixture_only=True)


def diagnostics():
    for name in CONTAINERS:
        result = run(['docker', 'logs', name], check=False)
        text = result.stdout + result.stderr
        selected = [line for line in text.splitlines()
                    if re.search(r'ERROR|Caused by:|Exception|validation error|extra_forbidden', line, re.I)
                    and not re.search(r'password|private.?key|public.?key|authorization|secret|token', line, re.I)]
        (EVIDENCE / (name + '-safe-diagnostics.log')).write_text('\n'.join(selected[-150:]) + '\n')


def verify():
    require(re.fullmatch(r'v52-rollback-[0-9]+', PREFIX) is not None, 'owned_resource_prefix')
    require(run(['git', '-C', 'candidate-source', 'rev-parse', 'HEAD']).stdout.strip() == CANDIDATE, 'candidate_source_pin')
    require(run(['git', '-C', 'old-source', 'rev-parse', 'HEAD']).stdout.strip() == OLD_BACKEND, 'old_source_pin')
    for file in Path('old-source/backend/src/main/resources/db/migration').glob('*.sql'):
        require(file.read_bytes() == Path('candidate-source/backend/src/main/resources/db/migration', file.name).read_bytes(),
                'unchanged_previous_migration_' + file.name)
    require(not Path('candidate-source/backend/src/main/resources/fonts/Pretendard-Regular.ttf').exists(), 'no_unapproved_font')
    resolved = json.loads((EVIDENCE / 'old-image-resolution.json').read_text())
    require(all(x['anonymous_pull_succeeded'] for x in resolved.values()), 'both_exact_old_images_available')
    REPORT['old_images'] = resolved
    case('Pinned laboratory source and exact old image pair; V1–V48 migration bytes unchanged')
    run(['docker', 'pull', 'pgvector/pgvector:pg17'], timeout=300)
    run(['docker', 'pull', 'eclipse-temurin:21-jre'], timeout=300)
    run(['docker', 'network', 'create', '--internal', NETWORK])
    require(run(['docker', 'network', 'inspect', '--format', '{{.Internal}}', NETWORK]).stdout.strip() == 'true', 'internal_network_blocks_provider_routing')
    CONTAINERS.append(DATABASE)
    run(['docker', 'run', '-d', '--name', DATABASE, '--network', NETWORK,
         '--network-alias', 'postgres', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
         '-e', 'POSTGRES_DB=' + DB_NAME, 'pgvector/pgvector:pg17'])
    try:
        for _ in range(60):
            if run(['docker', 'exec', DATABASE, 'pg_isready', '-U', 'postgres', '-d', DB_NAME], check=False).returncode == 0:
                break
            time.sleep(1)
        sql("CREATE EXTENSION vector; CREATE EXTENSION btree_gist; "
            "CREATE ROLE app_user LOGIN PASSWORD 'local_app_password'; "
            "CREATE ROLE agent_user LOGIN PASSWORD 'local_agent_password'; "
            "CREATE SCHEMA app AUTHORIZATION app_user; CREATE SCHEMA agent_runtime AUTHORIZATION agent_user; "
            "REVOKE CREATE ON SCHEMA public FROM PUBLIC;")
        version = scalar('SELECT version();')
        require(scalar("SELECT current_setting('server_version_num')::int/10000;") == '17', 'actual_postgres17_required')
        case('Isolated PostgreSQL17 with existing compose fixture roles and no production data', postgres_version=version,
             vector_version=scalar("SELECT extversion FROM pg_extension WHERE extname='vector';"))
        private, private_der, public_der, public_pem = test_keys()
        backend_env = {'DB_URL': f'jdbc:postgresql://postgres:5432/{DB_NAME}', 'DB_USERNAME': 'app_user',
            'DB_PASSWORD': 'local_app_password', 'APP_ENVIRONMENT': 'test',
            'AGENT_BASE_URL': 'http://agent:8000', 'AGENT_COMMAND_DISPATCH_ENABLED': 'false',
            'AGENT_RECONCILIATION_ENABLED': 'false', 'AGENT_ROUTE_OBSERVATION_COLLECTION_ENABLED': 'false',
            'PLATFORM_AI_SPEND_ENABLED': 'false', 'PLATFORM_AI_SPEND_COMPLETION_ENABLED': 'false',
            'APP_NOTICES_DISPATCH_ENABLED': 'false', 'APP_AUTH_EMAIL_VERIFICATION_REQUIRED': 'false',
            'APP_RATE_LIMIT_ENABLED': 'false', 'AGENT_DELEGATION_TOKEN_PRIVATE_KEY': private_der,
            'AGENT_DELEGATION_TOKEN_PUBLIC_KEY': public_der}
        agent_env = {'AGENT_ENVIRONMENT': 'test', 'AGENT_DATABASE_URL': f'postgresql://agent_user:local_agent_password@postgres:5432/{DB_NAME}',
            'AGENT_RUN_STORE_BACKEND': 'postgres', 'AGENT_CHECKPOINT_BACKEND': 'postgres',
            'AGENT_BACKEND_INTERNAL_URL': 'http://backend:8080', 'AGENT_DELEGATION_TOKEN_PUBLIC_KEY': public_pem,
            'AGENT_WEB_RESEARCH_ENABLED': 'false', 'AGENT_TASK_SHADOW_ENABLED': 'false',
            'AGENT_FIFO_DISPATCHER_ENABLED': 'false', 'LANGSMITH_TRACING': 'false', 'LANGSMITH_TRACING_V2': 'false'}
        old_pair = [start('baseline', 'backend', backend_env, OLD_IMAGES['backend']),
                    start('baseline', 'agent', agent_env, OLD_IMAGES['agent'])]
        login, email, password = register_login()
        bearer = login['accessToken']
        ids = {'workspace': login['workspaceId'], 'user': login['userId']}
        base = '/api/v2/workspaces/' + ids['workspace']
        customer = expect(18324, 'POST', base + '/clients', 201, {'name': '합성 고객', 'companyName': 'Synthetic only', 'email': 'fixture@example.invalid'}, bearer)
        project = expect(18324, 'POST', base + '/projects', 201, {'clientId': customer['id'], 'title': '합성 롤백 프로젝트', 'requirementText': '합성 원문 요구사항', 'currency': 'KRW'}, bearer)
        ids.update(project=project['id'], run=str(uuid4()))
        seed_saved_run(ids, 'COMPLETED', with_source_columns=False)
        initial_agent = expect(18325, 'GET', '/internal/v1/agent-runs/' + ids['run'], 200, bearer=delegated(private, ids))
        require(initial_agent['status'] == 'COMPLETED', 'old_agent_legacy_result_read')
        baseline = schema_snapshot('baseline-v48', 48)
        zero_execution()
        case('Actual old Spring and Agent baseline V48 APIs read persisted synthetic result')
        stop_pair(old_pair)
        jars = [x for x in Path('candidate-source/backend/build/libs').glob('*.jar') if not x.name.endswith('-plain.jar')]
        require(len(jars) == 1, 'one_candidate_bootjar')
        candidate_pair = [start('candidate', 'backend', backend_env, 'eclipse-temurin:21-jre', jar=jars[0]),
                          start('candidate', 'agent', agent_env, 'v52-candidate-agent:' + CANDIDATE)]
        require(schema_snapshot('forward-v52', 52)['runtime_saved_data'] == baseline['runtime_saved_data'], 'forward_preserves_legacy_result_usage')
        case('Candidate startup applies V49→V52 and preserves saved results and zero-call usage', migration_count=52)
        sql(f"UPDATE app.agent_run SET source_project_version=0,workflow_mode='PROJECT_ANALYSIS' WHERE id={literal(ids['run'])}; "
            f"INSERT INTO app.source_message(workspace_id,project_id,run_id,event_key,kind,content,created_by) VALUES "
            f"({literal(ids['workspace'])},{literal(ids['project'])},{literal(ids['run'])},'synthetic-input','RUN_INPUT','합성 원문 요구사항',{literal(ids['user'])});")
        control = delegated(private, ids)
        expect(18325, 'GET', '/internal/v1/agent-runs/' + ids['run'], 200, bearer=control)
        reject = expect(18325, 'POST', '/internal/v1/agent-runs', 403,
            json.loads(scalar(f"SELECT request_json FROM agent_runtime.agent_run_state WHERE run_id={literal(ids['run'])};")), control)
        require(reject['code'] == 'EXECUTION_AUTHORITY_REQUIRED', 'legacy_start_fails_closed')
        case('New Agent control read remains valid; legacy deadline-free START rejects403 without execution')
        spec = api_artifacts(ids, bearer)
        partial = {**ids, 'run': str(uuid4())}
        seed_saved_run(partial, 'PARTIAL', with_source_columns=True)
        expect(18325, 'GET', '/internal/v1/agent-runs/' + partial['run'], 200, bearer=delegated(private, partial))
        require(expect(18324, 'GET', base + '/agent-runs/' + partial['run'], 200, bearer=bearer)['status'] == 'PARTIAL', 'new_app_partial_projection')
        case('V52 PARTIAL app constraint and actual new Agent/Spring projection')
        seed_conservative_liability(ids)
        before = schema_snapshot('before-pair-rollback', 52)
        zero_execution()
        stop_pair(candidate_pair)
        rolled_back = [start('rollback', 'backend', backend_env, OLD_IMAGES['backend']),
                       start('rollback', 'agent', agent_env, OLD_IMAGES['agent'])]
        after = schema_snapshot('after-old-pair-startup', 52)
        require(before == after, 'old_pair_startup_preserves_complete_v52_schema_history_artifacts_and_liability')
        case('Exact old image pair starts healthy on V52; full schema/history and saved artifact/liability unchanged')
        old_login = expect(18324, 'POST', '/api/v2/auth/login', 200, {'email': email, 'password': password})
        old_bearer = old_login['accessToken']
        require(expect(18324, 'GET', base + '/projects/' + ids['project'], 200, bearer=old_bearer)['id'] == ids['project'], 'old_project_read')
        expect(18324, 'GET', base + '/projects/' + ids['project'] + '/quotations', 200, bearer=old_bearer)
        expect(18324, 'GET', base + '/documents/' + spec['reusableDocumentId'], 200, bearer=old_bearer)
        for context in (ids, partial):
            row = expect(18325, 'GET', '/internal/v1/agent-runs/' + context['run'], 200, bearer=delegated(private, context))
            require(row['result']['projectSummary'] == '합성 저장 결과' and row['usage']['modelCalls'] == 0,
                    'old_agent_reads_exact_saved_results_and_usage')
            expect(18325, 'GET', '/internal/v1/agent-runs/' + context['run'], 403,
                   bearer=delegated(private, context, run_id=str(uuid4())))
        require(expect(18324, 'GET', base + '/agent-runs/' + partial['run'], 200, bearer=old_bearer)['status'] == 'PARTIAL', 'old_backend_reads_partial_on_v52')
        require(schema_snapshot('after-old-pair-reads', 52) == before, 'old_pair_reads_preserve_v52_artifacts_and_budget')
        zero_execution()
        case('Rollback pair real login/project/document/COMPLETED/PARTIAL reads; scope rejection and no paid replay')
        changed = expect(18324, 'PATCH', base + '/projects/' + ids['project'], 200,
            {'clientId': customer['id'], 'title': '합성 변경', 'requirementText': '합성 변경된 요구사항', 'currency': 'KRW', 'status': 'LEAD'}, old_bearer)
        require(changed['requirementText'] == '합성 변경된 요구사항', 'old_api_write_works_with_v51_trigger')
        require(json.loads(scalar(f"SELECT row_to_json(r) FROM app.specification r WHERE id={literal(spec['id'])};")) ==
                next(x for x in before['immutable_and_money_data']['specification'] if x['id'] == spec['id']),
                'old_write_preserves_immutable_specification')
        require(scalar(f"SELECT source_specification_id FROM app.document WHERE id={literal(spec['reusableDocumentId'])};") == spec['id'],
                'old_write_preserves_document_provenance')
        after_write = schema_snapshot('after-old-pair-project-write', 52)
        require(after_write['schema_sha256'] == before['schema_sha256'], 'old_write_preserves_schema')
        for table in ('analysis_decision', 'specification', 'platform_spend_reservation', 'platform_spend_settlement', 'platform_spend_month_entry'):
            require(after_write['immutable_and_money_data'][table] == before['immutable_and_money_data'][table], 'old_write_preserves_' + table)
        zero_execution()
        case('Old project write remains compatible with V51 invalidation trigger; immutable provenance and monthly liability preserved')
        stop_pair(rolled_back)
        restored_pair = [start('re-forward', 'backend', backend_env, 'eclipse-temurin:21-jre', jar=jars[0]),
                         start('re-forward', 'agent', agent_env, 'v52-candidate-agent:' + CANDIDATE)]
        require(schema_snapshot('re-forward-v52', 52) == after_write, 're_forward_preserves_v52_schema_and_data')
        require(expect(18324, 'GET', f"{base}/projects/{ids['project']}/specifications/{spec['id']}", 200, bearer=bearer)['sourceCurrent'] is False,
                'new_backend_observes_old_write_source_invalidation')
        zero_execution()
        case('Candidate pair re-forward validates V52 unchanged and observes source invalidation after old write')
        REPORT['result'] = 'passed'
    except Exception as exc:
        REPORT['result'] = 'failed'
        REPORT['failure'] = str(exc) if type(exc) in (AssertionError, RuntimeError) else type(exc).__name__
        raise
    finally:
        diagnostics()
        save('summary.json', REPORT)
        for name in reversed(CONTAINERS):
            run(['docker', 'rm', '-f', name], check=False)
        run(['docker', 'network', 'rm', NETWORK], check=False)


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ('resolve-images', 'verify'):
        raise SystemExit('usage: verify_pair.py {resolve-images|verify}')
    if sys.argv[1] == 'resolve-images':
        resolve_images()
    else:
        verify()
