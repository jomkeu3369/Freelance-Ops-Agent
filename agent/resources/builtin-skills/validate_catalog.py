#!/usr/bin/env python3
"""Validate catalog structure and fixtures. Does not claim application routing was run."""
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT=Path(__file__).resolve().parent
catalog=json.loads((ROOT/'builtin-skills.catalog.json').read_text(encoding='utf-8'))
schema=json.loads((ROOT/'builtin-skills.schema.json').read_text(encoding='utf-8'))
index=json.loads((ROOT/'builtin-skills.index.json').read_text(encoding='utf-8'))
fixtures=json.loads((ROOT/'acceptance-cases.json').read_text(encoding='utf-8'))
checks=[]
def check(name, condition):
    checks.append({'name':name,'passed':bool(condition)})
    if not condition:
        raise AssertionError(name)

Draft202012Validator.check_schema(schema)
errors=sorted(Draft202012Validator(schema,format_checker=FormatChecker()).iter_errors(catalog),key=lambda e:str(e.path))
check('json_schema_valid',not errors)
S=catalog['skills'];ids=[s['id'] for s in S];valid=set(ids)
check('exactly_60_skills',len(S)==catalog['skill_count']==60)
check('unique_stable_ids',len(valid)==60)
check('unique_korean_names',len({s['name']['ko'] for s in S})==60)
check('unique_english_names',len({s['name']['en'] for s in S})==60)
check('localized_names_and_summaries',all(re.search('[가-힣]',s['name']['ko']) and re.search('[가-힣]',s['summary']['ko']) and re.search('[a-zA-Z]',s['name']['en']) for s in S))
check('unique_category_ids',len({c['id'] for c in catalog['categories']})==8)
expected={c['id']:c['expected_count'] for c in catalog['categories']}
check('category_counts_match',dict(Counter(s['category'] for s in S))==expected)
check('workflow_steps_sequential',all([x['step'] for x in s['workflow']]==list(range(1,len(s['workflow'])+1)) for s in S))
check('workflow_bodies_distinct',len({tuple(x['instruction'] for x in s['workflow']) for s in S})==60)
check('input_keys_unique',all(len({x['key'] for x in s['required_inputs']})==len(s['required_inputs']) for s in S))
check('all_skills_have_concrete_output_checks',all(all(len(x['acceptance_criteria'])>=30 for x in s['deliverables']) for s in S))
check('all_skills_have_boundaries_and_limits',all(len(s['limitations'])>=2 and len(s['permission_boundaries'])>=2 for s in S))
check('builtin_access_free',all(s['builtin'] and s['price']['amount']==0 for s in S) and catalog['cost_policy']['skill_access_price']==0)
check('no_additional_paid_api_dependency',catalog['cost_policy']['additional_paid_api_dependency'] is False)
check('actual_api_billing_not_fixed_credits',catalog['cost_policy']['execution_billing_basis']=='actual_api_cost' and catalog['cost_policy']['usage_display']=='weekly_limit_percentage' and catalog['cost_policy']['fixed_model_credit_cost'] is False)
check('auto_default_bounded',catalog['selection_defaults']['mode']=='auto' and catalog['selection_defaults']['max_active_skills']==3 and catalog['selection_defaults']['load_full_catalog_into_model_context'] is False)
keys=('id','category','name','summary','triggers','exclusions','routing_tags')
check('index_exactly_matches_catalog_metadata',index['skills']==[{k:s[k] for k in keys} for s in S])
check('index_has_no_workflow_bodies',all('workflow' not in s for s in index['skills']))
check('index_version_matches',index['catalog_version']==catalog['catalog_version'])
F=fixtures['cases'];check('40_unique_acceptance_cases',len(F)==40 and len({c['id'] for c in F})==40)
for c in F:
    for k in ['expected_primary']:
        if c.get(k) is not None: check(c['id']+'_'+k+'_exists',c[k] in valid)
    for k in ['allowed_supporting','must_not_select','required_across_stages','selected_ids','excluded_ids']:
        if k in c: check(c['id']+'_'+k+'_exist',all(x in valid for x in c[k]))
    if 'manual_ids' in c and c['id']!='unknown-id': check(c['id']+'_manual_ids_exist',all(x in valid for x in c['manual_ids']))
    if c['kind']=='routing':
        check(c['id']+'_no_contradictory_expectation',c['expected_primary'] not in c['must_not_select'] and not(set(c['allowed_supporting']) & set(c['must_not_select'])))
check('fixtures_cover_required_concerns',{'routing','staging','state','runtime','ui','billing','permission','privacy'} <= {c['kind'] for c in F})
report={
 'result':'pass','schema_version':catalog['schema_version'],'skill_count':len(S),'category_counts':expected,
 'checks_passed':len(checks),'checks':checks,'acceptance_fixture_count':len(F),
 'application_routing_tests_executed':False,'repository_code_changed':False,
 'scope':'Catalog schema, content structure, uniqueness, billing invariants, index parity, and fixture references only. Application routing, UI, billing integration, and permissions must be tested in the target repository.',
 'catalog_sha256':hashlib.sha256((ROOT/'builtin-skills.catalog.json').read_bytes()).hexdigest()
}
(ROOT/'validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:report[k] for k in ['result','skill_count','category_counts','checks_passed','acceptance_fixture_count','application_routing_tests_executed','catalog_sha256']},indent=2))
