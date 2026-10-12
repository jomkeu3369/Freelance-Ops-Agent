#!/usr/bin/env python3
"""Independently cross-check preserved CSV/JSON and export transparent stage rows.

Read-only evidence analysis. Never uploads or contacts a service. Pass the extracted
artifact directory and an output directory. Raw HTTP bodies/credentials are absent.
"""
from collections import Counter, defaultdict
import argparse
import csv
import json
import math
from pathlib import Path
import re
import statistics


def quantile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def require(value, message):
    if not value:
        raise ValueError(message)


def validate_case(root):
    summary = json.loads((root / 'summary.json').read_text())
    stages = summary['stages'] + summary.get('pages', {}).get('stages', [])
    stage_by_name = {stage['name']: stage for stage in stages}
    rows = list(csv.DictReader((root / 'requests.csv').open()))
    grouped = defaultdict(list)
    for row in rows:
        require(row['stage'] in stage_by_name, 'CSV contains a stage missing from summary')
        require(row['valid'] in ('True', 'False'), 'Invalid CSV Boolean')
        grouped[(row['stage'], row['route'])].append(row)
    output = []
    for stage in stages:
        require(stage['requests'] == sum(len(v) for (name, _), v in grouped.items() if name == stage['name']), 'Stage request count mismatch')
        for route, metrics in stage['routes'].items():
            records = grouped[(stage['name'], route)]
            require(metrics['n'] == len(records) > 0, 'Route request count mismatch')
            values = [float(row['latency_ms']) for row in records]
            for field, fraction in (('p50_ms', .5), ('p95_ms', .95), ('p99_ms', .99)):
                require(metrics[field] == quantile(values, fraction), field + ' mismatch')
            require(metrics['max_ms'] == max(values), 'Max latency mismatch')
            require(metrics['p99_schedule_lag_ms'] == quantile([float(row['schedule_lag_ms']) for row in records], .99), 'Dispatch lag mismatch')
            require(metrics['mean_response_bytes'] == round(statistics.mean(int(row['bytes']) for row in records)), 'Mean bytes mismatch')
            statuses = Counter(row['status'] for row in records)
            require(metrics['status_counts'] == statuses, 'Status counts mismatch')
            failed = sum(row['valid'] == 'False' for row in records)
            require(metrics['errors'] == failed, 'Failure count mismatch')
            expected = {
                'http_429': statuses['429'], 'transport_errors': statuses['0'],
                'unexpected_4xx': sum(v for k, v in statuses.items() if 400 <= int(k) < 500 and k != '429'),
                'server_5xx': sum(v for k, v in statuses.items() if int(k) >= 500),
                'semantic_failures': sum(row['status'] == '200' and row['valid'] == 'False' for row in records),
            }
            require(all(metrics[k] == value for k, value in expected.items()), 'Error category mismatch')
            route_gate = metrics['p95_ms'] < 500 and metrics['p99_ms'] < 1000 and failed / len(records) < .01 and metrics['semantic_failures'] == 0 and metrics['p99_schedule_lag_ms'] < 100
            require(metrics['observed_gate_pass'] == route_gate, 'Route gate mismatch')
            require(metrics['tail_sample_warning'] == (len(records) < 100), 'Small-tail warning mismatch')
            output.append({'case': root.name, 'product_sha': summary.get('product_sha', summary['baseline']),
                'stage': stage['name'], 'quotation_count': stage['quotation_count'],
                'response_scope': 'page50' if 'page_' in stage['name'] else 'full-data',
                'route': route, 'target_total_rps': stage['target_rps'], 'actual_total_rps': stage['achieved_rps'],
                'duration_s': stage['duration_s'], 'n': metrics['n'], 'p50_ms': metrics['p50_ms'],
                'p95_ms': metrics['p95_ms'], 'p99_ms': metrics['p99_ms'], 'mean_response_bytes': metrics['mean_response_bytes'],
                'errors': failed, 'http_429': metrics['http_429'], 'dropped_stage': stage['dropped'],
                'route_gate': route_gate, 'stage_gate': stage['observed_gate_pass'], 'weak_tail_n_lt_100': len(records) < 100,
                'abort': stage['abort'] or ''})
        expected_gate = bool(stage['requests']) and stage['dropped'] == 0 and stage['target_attainment_fraction'] >= .95 and not stage['abort'] and all(row['observed_gate_pass'] for row in stage['routes'].values())
        require(stage['observed_gate_pass'] == expected_gate, 'Whole-stage gate mismatch')
    require(sum(stage['requests'] for stage in stages) == len(rows), 'Measured total mismatch')
    for probe in summary['query_probes']:
        count = probe['quotation_count']
        expected = 1 + 3*count if summary.get('case', 'baseline') == 'baseline' else 1 + 3*math.ceil(count/100)
        require(probe['quotation_family_select_calls'] == expected, 'Legacy SQL scaling mismatch')
        statements = [s for s in probe['statements'] if re.search(r'\bapp\.quotation(?:\b|_)', s['query'])]
        require(sum(s['calls'] for s in statements) == expected, 'Legacy SQL statement evidence mismatch')
        require(sum(s['rows'] for s in statements) == 13*count, 'Legacy SQL rows mismatch')
    for probe in summary.get('pages', {}).get('query_probes', []):
        require(probe['quotation_family_select_calls'] == 4, 'Page SQL count mismatch')
        count, limit = probe['quotation_count'], probe['limit']
        require(probe['quotation_family_rows'] == min(count, limit+1) + 12*min(count, limit), 'Page row evidence mismatch')
    state = json.loads((root / 'backend-final-state.json').read_text())
    require(not state['OOMKilled'], 'Backend OOM')
    resources = json.loads((root / 'resources.json').read_text())
    max_cpu = {}
    max_memory_pct = {}
    for row in resources:
        if 'Name' in row:
            name = row['Name']
            max_cpu[name] = max(max_cpu.get(name, 0), float(row['CPUPerc'].rstrip('%')))
            max_memory_pct[name] = max(max_memory_pct.get(name, 0), float(row['MemPerc'].rstrip('%')))
    sessions = [row['db_sessions'] for row in resources if 'db_sessions' in row]
    stats = {'case': root.name, 'validated_measured_requests': len(rows),
        'status_counts': dict(Counter(row['status'] for row in rows)), 'errors': sum(row['valid'] == 'False' for row in rows),
        'stages': len(stages), 'stage_passes': sum(bool(stage['observed_gate_pass']) for stage in stages),
        'abort': summary.get('abort'), 'fatal_error': summary.get('error'),
        'max_cpu_pct_sampled': max_cpu, 'max_memory_pct_sampled': max_memory_pct,
        'max_db_sessions_sampled': {key: max((s[key] for s in sessions), default=0) for key in ('connections','active','waiting')},
        'product_sha': summary.get('product_sha'), 'fixture_sha256': summary.get('fixture_sha256'),
        'completed_page_controls': len(summary.get('pages', {}).get('controls', []))}
    return output, stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('artifact_root', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    output, validations = [], []
    for case in ('baseline', 'optimized', 'optimized-page'):
        rows, validation = validate_case(args.artifact_root / case)
        output += rows
        validations.append(validation)
    fixture_hashes = {v['fixture_sha256'] for v in validations}
    require(len(fixture_hashes) == 1 and None not in fixture_hashes, 'Fixture differs between cases')
    with (args.output / 'quotation-optimization-stages.csv').open('w', newline='') as target:
        writer = csv.DictWriter(target, fieldnames=list(output[0]))
        writer.writeheader(); writer.writerows(output)
    (args.output / 'validation.json').write_text(json.dumps(validations, indent=2) + '\n')
    print(json.dumps(validations, indent=2))


if __name__ == '__main__':
    main()
