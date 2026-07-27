from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langsmith import Client, traceable
from langsmith.evaluation import evaluate
from pydantic import BaseModel, Field

from test.prototypes.react_prototype_v1 import configure_langsmith, get_env_value, run_react_prototype
from test.prototypes.supervisor_prototype_v1 import run_supervisor_prototype

from dotenv import load_dotenv
load_dotenv()

class JudgeVerdict(BaseModel):
    score: float = Field(ge=0, le=1)
    passed: bool
    justification: str
    findings: list[str] = Field(default_factory=list)


JUDGE_PROMPTS: dict[str, str] = {
    "completeness": """
당신은 요구사항 완전성 평가자입니다.
입력, 기준 출력과 실제 출력을 비교해 사용자가 말한 목표와 required_topics가 요구사항 또는 blocking gap에 반영됐는지 평가하십시오.
모든 문구가 동일할 필요는 없지만 의미가 보존되어야 합니다.
status가 expected_status와 다른 경우 그 차이가 실제 입력으로 정당화되는지도 확인하십시오.
0에서 1 사이 점수, 통과 여부, 짧은 근거와 발견 사항만 반환하고 사고 과정은 출력하지 마십시오.
""",
    "groundedness": """
당신은 요구사항 근거성과 환각 억제 평가자입니다.
실제 출력의 확정 요구사항과 assumption이 사용자 입력, project fixture 또는 domain rule로 뒷받침되는지 평가하십시오.
forbidden_assumptions가 사실로 확정되면 크게 감점하십시오.
불명확한 내용을 gap이나 질문으로 남긴 것은 감점하지 마십시오.
0에서 1 사이 점수, 통과 여부, 짧은 근거와 발견 사항만 반환하고 사고 과정은 출력하지 마십시오.
""",
    "clarification_quality": """
당신은 확인 질문 품질 평가자입니다.
NEEDS_INPUT 사례에서는 blocking gap이 사용자가 답할 수 있는 구체적이고 중복 없는 최소 질문으로 연결됐는지 평가하십시오.
READY 사례에서는 불필요한 질문이 없는지 평가하십시오.
expected_question_fields는 의미 기준이며 정확한 문자열 일치는 요구하지 않습니다.
0에서 1 사이 점수, 통과 여부, 짧은 근거와 발견 사항만 반환하고 사고 과정은 출력하지 마십시오.
"""
}


def require_environment() -> None:
    missing = [name for name in ["OPENAI_API_KEY", "LANGSMITH_API_KEY"] if not get_env_value(name, "")]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
    os.environ["LANGSMITH_PROJECT"] = get_env_value("LANGSMITH_PROJECT", "freelance-ops-requirements-eval-v1")
    configure_langsmith()


def create_judge_model(metric: str) -> Any:
    default_model = get_env_value("EVAL_JUDGE_MODEL", "gpt-5.6-luna")
    model_name = get_env_value(f"JUDGE_{metric.upper()}_MODEL", default_model)
    model = ChatOpenAI(
        model=model_name,
        reasoning_effort=get_env_value("EVAL_JUDGE_REASONING_EFFORT", "low"),
        use_responses_api=True,
        timeout=float(get_env_value("EVAL_TIMEOUT_SECONDS", "90")),
        max_retries=int(get_env_value("EVAL_MAX_RETRIES", "2"))
    )
    return model.with_structured_output(JudgeVerdict, method="json_schema")


def build_llm_judge(metric: str) -> Callable[[dict[str, Any], dict[str, Any], dict[str, Any]], dict[str, Any]]:
    judge = create_judge_model(metric)

    @traceable(name=f"llm_as_judge_{metric}", run_type="chain")
    def evaluator(inputs: dict[str, Any], outputs: dict[str, Any], reference_outputs: dict[str, Any]) -> dict[str, Any]:
        payload = json.dumps({"inputs": inputs, "reference_outputs": reference_outputs, "actual_outputs": outputs}, ensure_ascii=False)
        verdict = judge.invoke([SystemMessage(content=JUDGE_PROMPTS[metric]), HumanMessage(content=payload)])
        parsed = verdict if isinstance(verdict, JudgeVerdict) else JudgeVerdict.model_validate(verdict)
        return {
            "key": f"judge_{metric}",
            "score": parsed.score,
            "comment": json.dumps({"passed": parsed.passed, "justification": parsed.justification, "findings": parsed.findings}, ensure_ascii=False)
        }

    evaluator.__name__ = f"judge_{metric}"
    return evaluator


def read_cases(path: Path) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as file:
        for line_number, line in enumerate(file, start=1):
            if line.strip():
                try:
                    cases.append(json.loads(line))
                except json.JSONDecodeError as error:
                    raise ValueError(f"Invalid JSONL at line {line_number}: {error}") from error
    if not cases:
        raise ValueError("Evaluation dataset is empty")
    return cases


def ensure_langsmith_dataset(client: Client, dataset_name: str, cases: list[dict[str, Any]]) -> str:
    existing = next(iter(client.list_datasets(dataset_name=dataset_name, limit=1)), None)
    if existing is not None:
        return str(existing.id)
    dataset = client.create_dataset(dataset_name=dataset_name, description="Requirement-analysis architecture comparison v1")
    client.create_examples(
        examples=[{
            "inputs": case["inputs"],
            "outputs": case["outputs"],
            "metadata": {"case_id": case["id"], "schema_version": "requirements-eval.v1"}
        } for case in cases],
        dataset_id=dataset.id
    )
    return str(dataset.id)


def get_target(architecture: str) -> Callable[[dict[str, Any]], dict[str, Any]]:
    if architecture == "react":
        return run_react_prototype
    if architecture == "supervisor":
        return run_supervisor_prototype
    raise ValueError(f"Unsupported architecture: {architecture}")


def run_architecture_evaluation(architecture: str, dataset_name: str, max_concurrency: int) -> Any:
    judges = [build_llm_judge("completeness"), build_llm_judge("groundedness"), build_llm_judge("clarification_quality")]
    return evaluate(
        get_target(architecture),
        data=dataset_name,
        evaluators=judges,
        experiment_prefix=f"requirements-{architecture}-v1",
        metadata={
            "architecture": architecture,
            "models": [get_env_value("PROTOTYPE_MODEL", "gpt-5.6-terra"), get_env_value("EVAL_JUDGE_MODEL", "gpt-5.6-luna")],
            "dataset_schema": "requirements-eval.v1",
            "judge_count": 3
        },
        max_concurrency=max_concurrency
    )


def get_result_field(value: Any, field: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(field, default)
    return getattr(value, field, default)


def parse_judge_passed(comment: Any, score: float, pass_threshold: float) -> bool:
    if isinstance(comment, str):
        try:
            parsed = json.loads(comment)
            if isinstance(parsed, dict) and isinstance(parsed.get("passed"), bool):
                return parsed["passed"]
        except json.JSONDecodeError:
            pass
    return score >= pass_threshold


def summarize_experiment(architecture: str, experiment_results: Any, pass_threshold: float) -> dict[str, Any]:
    metric_scores: dict[str, list[float]] = defaultdict(list)
    metric_passes: dict[str, list[bool]] = defaultdict(list)
    cases: list[dict[str, Any]] = []
    for row in experiment_results:
        example = get_result_field(row, "example")
        run = get_result_field(row, "run")
        evaluation_results = get_result_field(row, "evaluation_results", {})
        example_metadata = get_result_field(example, "metadata", {}) or {}
        case_id = example_metadata.get("case_id") or str(get_result_field(example, "id", "unknown"))
        run_error = get_result_field(run, "error")
        feedback_items = get_result_field(evaluation_results, "results", []) or []
        case_scores: dict[str, float] = {}
        failed_metrics: list[str] = []
        for feedback in feedback_items:
            metric = str(get_result_field(feedback, "key", "unknown"))
            raw_score = get_result_field(feedback, "score")
            if not isinstance(raw_score, int | float | bool):
                continue
            score = float(raw_score)
            passed = parse_judge_passed(get_result_field(feedback, "comment"), score, pass_threshold)
            case_scores[metric] = score
            metric_scores[metric].append(score)
            metric_passes[metric].append(passed)
            if not passed:
                failed_metrics.append(metric)
        case_passed = not run_error and bool(case_scores) and not failed_metrics
        cases.append({
            "case_id": case_id,
            "passed": case_passed,
            "scores": case_scores,
            "failed_metrics": failed_metrics,
            "error": str(run_error) if run_error else None
        })

    metrics: dict[str, dict[str, Any]] = {}
    all_scores: list[float] = []
    all_passes: list[bool] = []
    for metric in sorted(metric_scores):
        scores = metric_scores[metric]
        passes = metric_passes[metric]
        all_scores.extend(scores)
        all_passes.extend(passes)
        metrics[metric] = {
            "average": round(sum(scores) / len(scores), 4),
            "minimum": round(min(scores), 4),
            "maximum": round(max(scores), 4),
            "passed": sum(passes),
            "total": len(passes),
            "pass_rate": round(sum(passes) / len(passes), 4)
        }

    passed_cases = sum(bool(case["passed"]) for case in cases)
    return {
        "architecture": architecture,
        "experiment_name": str(get_result_field(experiment_results, "experiment_name", "unknown")),
        "case_count": len(cases),
        "passed_cases": passed_cases,
        "case_pass_rate": round(passed_cases / len(cases), 4) if cases else 0,
        "overall_average": round(sum(all_scores) / len(all_scores), 4) if all_scores else 0,
        "judge_pass_rate": round(sum(all_passes) / len(all_passes), 4) if all_passes else 0,
        "metrics": metrics,
        "failed_cases": [case for case in cases if not case["passed"]],
        "cases": cases
    }


def select_best_architecture(summaries: list[dict[str, Any]]) -> str | None:
    if len(summaries) < 2:
        return None
    ranked = sorted(summaries, key=lambda summary: (summary["overall_average"], summary["case_pass_rate"]), reverse=True)
    best = ranked[0]
    runner_up = ranked[1]
    if best["overall_average"] == runner_up["overall_average"] and best["case_pass_rate"] == runner_up["case_pass_rate"]:
        return None
    return str(best["architecture"])


def build_evaluation_report(dataset_name: str, dataset_id: str, summaries: list[dict[str, Any]], pass_threshold: float) -> dict[str, Any]:
    return {
        "schema_version": "requirements-eval-report.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset_name": dataset_name,
        "dataset_id": dataset_id,
        "pass_threshold": pass_threshold,
        "best_architecture": select_best_architecture(summaries),
        "architectures": summaries
    }


def format_score(value: Any) -> str:
    return f"{float(value):.3f}" if isinstance(value, int | float) else "-"


def print_evaluation_report(report: dict[str, Any]) -> None:
    summaries = report["architectures"]
    metric_names = ["judge_completeness", "judge_groundedness", "judge_clarification_quality"]
    headers = ["Architecture", "Cases", "Overall", "Case pass", "Completeness", "Groundedness", "Clarification", "Failed"]
    rows: list[list[str]] = []
    for summary in summaries:
        metrics = summary["metrics"]
        rows.append([
            str(summary["architecture"]),
            str(summary["case_count"]),
            format_score(summary["overall_average"]),
            f"{summary['case_pass_rate']:.1%}",
            format_score(metrics.get(metric_names[0], {}).get("average")),
            format_score(metrics.get(metric_names[1], {}).get("average")),
            format_score(metrics.get(metric_names[2], {}).get("average")),
            str(len(summary["failed_cases"]))
        ])
    widths = [max(len(headers[index]), *(len(row[index]) for row in rows)) for index in range(len(headers))]
    separator = "-+-".join("-" * width for width in widths)
    print("\nRequirements Evaluation Summary")
    print(" | ".join(headers[index].ljust(widths[index]) for index in range(len(headers))))
    print(separator)
    for row in rows:
        print(" | ".join(row[index].ljust(widths[index]) for index in range(len(headers))))
    best_architecture = report.get("best_architecture")
    print(f"\nBest architecture: {best_architecture or 'tie or insufficient data'}")
    failed_cases = [(summary["architecture"], case) for summary in summaries for case in summary["failed_cases"]]
    if failed_cases:
        print("\nFailed cases")
        for architecture, case in failed_cases:
            reason = case["error"] or ", ".join(case["failed_metrics"]) or "missing judge scores"
            print(f"- {architecture} / {case['case_id']}: {reason}")


def write_evaluation_report(report: dict[str, Any], report_dir: Path) -> Path:
    report_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_path = report_dir / f"requirements-eval-summary-{timestamp}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare ReAct and Supervisor requirement-analysis accuracy in LangSmith")
    parser.add_argument("--architecture", choices=["react", "supervisor", "both"], default="both")
    parser.add_argument("--dataset-name", default="freelance-ops-requirements-v1")
    parser.add_argument("--cases", type=Path, default=Path(__file__).with_name("requirements_cases_v1.jsonl"))
    parser.add_argument("--max-concurrency", type=int, default=1)
    parser.add_argument("--pass-threshold", type=float, default=float(get_env_value("EVAL_PASS_THRESHOLD", "0.8")))
    parser.add_argument("--report-dir", type=Path, default=Path(__file__).with_name("reports"))
    return parser.parse_args()


def main() -> None:
    arguments = parse_args()
    require_environment()
    cases = read_cases(arguments.cases)
    client = Client()
    dataset_id = ensure_langsmith_dataset(client, arguments.dataset_name, cases)
    architectures = ["react", "supervisor"] if arguments.architecture == "both" else [arguments.architecture]
    print(json.dumps({"dataset_name": arguments.dataset_name, "dataset_id": dataset_id, "architectures": architectures}, ensure_ascii=False))
    summaries: list[dict[str, Any]] = []
    for architecture in architectures:
        experiment_results = run_architecture_evaluation(architecture, arguments.dataset_name, arguments.max_concurrency)
        summaries.append(summarize_experiment(architecture, experiment_results, arguments.pass_threshold))
    report = build_evaluation_report(arguments.dataset_name, dataset_id, summaries, arguments.pass_threshold)
    print_evaluation_report(report)
    report_path = write_evaluation_report(report, arguments.report_dir)
    print(f"\nJSON report: {report_path.resolve()}")


if __name__ == "__main__":
    main()
