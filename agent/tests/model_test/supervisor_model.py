"""Bounded Luna Supervisor prototype for workspace feature requirements.

This module intentionally lives under ``tests/model_test`` while the model-backed
workflow is being evaluated.  It is not a public API and does not access the
business database.  Production tools must be called through authenticated Spring
internal APIs after their contracts are implemented.

The graph is deliberately one-way and loop-free::

    main orchestrator
        -> requirements supervisor
        -> risk supervisor
        -> final verifier/merger
        -> END

Every node can make at most one model call.  The graph enforces a shared call and
output-token budget, preserves per-call usage/cost, and returns strict structured
outputs instead of private chain-of-thought.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections.abc import Callable, Sequence
from enum import StrEnum
from html import escape
from pathlib import Path
from typing import Any, Literal, NotRequired, Protocol, TypedDict, cast
from uuid import UUID, uuid4

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ConfigDict, Field, model_validator

DEFAULT_MODEL = "gpt-5.6-luna"
PROMPT_VERSION = "supervisor-model-v0.1.0"
OUTPUT_SCHEMA_VERSION = "v1"

LUNA_INPUT_USD_PER_MILLION = 1.0
LUNA_CACHED_INPUT_USD_PER_MILLION = 0.1
LUNA_OUTPUT_USD_PER_MILLION = 6.0


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SupervisorStatus(StrEnum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    NEEDS_CLARIFICATION = "NEEDS_CLARIFICATION"
    HUMAN_REQUIRED = "HUMAN_REQUIRED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    FAILED = "FAILED"


class RequirementKind(StrEnum):
    FUNCTIONAL = "FUNCTIONAL"
    NON_FUNCTIONAL = "NON_FUNCTIONAL"
    CONSTRAINT = "CONSTRAINT"


class RiskSeverity(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class SupervisorRequest(StrictModel):
    """Only mutable workflow input; trusted identity remains outside model prompts."""

    run_id: UUID = Field(default_factory=uuid4)
    requirement_text: str = Field(min_length=1, max_length=50_000)
    project_context: str = Field(default="", max_length=30_000)
    locale: str = Field(default="ko-KR", min_length=2, max_length=32)
    route_history: list[str] = Field(default_factory=lambda: ["SUPERVISOR"])
    max_model_calls: int = Field(default=4, ge=0, le=10)
    max_output_tokens: int = Field(default=4_096, ge=512, le=16_384)

    @model_validator(mode="after")
    def validate_route_history(self) -> SupervisorRequest:
        if not self.route_history or self.route_history[-1] != "SUPERVISOR":
            raise ValueError("The supervisor graph requires SUPERVISOR as the current route")
        if len(self.route_history) != len(set(self.route_history)):
            raise ValueError("A route cannot be visited twice in one escalation chain")
        return self


class SupervisorPlan(StrictModel):
    requirements_objective: str = Field(min_length=1, max_length=500)
    risk_objective: str = Field(min_length=1, max_length=500)
    shared_constraints: list[str] = Field(max_length=10)
    rationale: str = Field(min_length=1, max_length=500)


class RequirementFinding(StrictModel):
    requirement_id: str = Field(pattern=r"^REQ-[0-9]{3}$")
    kind: RequirementKind
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=1_000)
    acceptance_criteria: list[str] = Field(min_length=1, max_length=8)
    source_excerpt: str | None = Field(max_length=500)
    is_assumption: bool


class RequirementsResult(StrictModel):
    summary: str = Field(min_length=1, max_length=1_000)
    requirements: list[RequirementFinding] = Field(min_length=1, max_length=30)
    assumptions: list[str] = Field(max_length=20)
    unresolved_questions: list[str] = Field(max_length=20)


class RiskFinding(StrictModel):
    risk_id: str = Field(pattern=r"^RISK-[0-9]{3}$")
    category: str = Field(min_length=1, max_length=100)
    severity: RiskSeverity
    description: str = Field(min_length=1, max_length=1_000)
    affected_requirement_ids: list[str] = Field(max_length=20)
    evidence_or_assumption: str = Field(min_length=1, max_length=500)
    mitigation: str = Field(min_length=1, max_length=1_000)
    human_review_required: bool


class RiskResult(StrictModel):
    summary: str = Field(min_length=1, max_length=1_000)
    risks: list[RiskFinding] = Field(max_length=30)
    missing_evidence: list[str] = Field(max_length=20)
    human_review_required: bool


class FinalSupervisorResult(StrictModel):
    status: Literal["COMPLETED", "NEEDS_CLARIFICATION", "HUMAN_REQUIRED"]
    summary: str = Field(min_length=1, max_length=1_500)
    confirmed_requirement_ids: list[str] = Field(max_length=30)
    unresolved_questions: list[str] = Field(max_length=20)
    risk_ids: list[str] = Field(max_length=30)
    conflicts: list[str] = Field(max_length=20)
    next_action: str = Field(min_length=1, max_length=500)
    user_message: str = Field(min_length=1, max_length=4_000)


class TokenUsage(StrictModel):
    input_tokens: int = Field(ge=0)
    cached_input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


class ModelCallRecord(StrictModel):
    stage: str
    model: str
    latency_ms: float = Field(ge=0)
    usage: TokenUsage
    estimated_cost_usd: float = Field(ge=0)


class StructuredResponse[OutputT: StrictModel](StrictModel):
    output: OutputT
    model: str
    latency_ms: float = Field(ge=0)
    usage: TokenUsage


class StructuredModel(Protocol):
    def generate[OutputT: StrictModel](
        self,
        *,
        stage: str,
        schema: type[OutputT],
        system_prompt: str,
        user_payload: dict[str, object],
        max_output_tokens: int,
    ) -> StructuredResponse[OutputT]: ...


class SupervisorGraphArtifacts(StrictModel):
    """Files exported from the compiled LangGraph definition."""

    mermaid_path: Path
    svg_path: Path
    png_path: Path | None


class OpenAIResponsesModel:
    """Small Responses API adapter; import the SDK only for an actual live run."""

    def __init__(self, model: str = DEFAULT_MODEL, api_key: str | None = None) -> None:
        from openai import OpenAI

        self.model = model
        self.client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))

    def generate[OutputT: StrictModel](
        self,
        *,
        stage: str,
        schema: type[OutputT],
        system_prompt: str,
        user_payload: dict[str, object],
        max_output_tokens: int,
    ) -> StructuredResponse[OutputT]:
        started = time.perf_counter()
        response = self.client.responses.create(
            model=self.model,
            reasoning={"effort": "none"},
            store=False,
            max_output_tokens=max_output_tokens,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            text={
                "verbosity": "low",
                "format": {
                    "type": "json_schema",
                    "name": stage,
                    "strict": True,
                    "schema": schema.model_json_schema(),
                },
            },
        )
        usage = response.usage
        if usage is None:
            raise RuntimeError(f"{stage}: provider response did not contain usage")
        details = getattr(usage, "input_tokens_details", None)
        cached_tokens = int(getattr(details, "cached_tokens", 0) or 0)
        parsed = schema.model_validate_json(response.output_text)
        return StructuredResponse[OutputT](
            output=parsed,
            model=self.model,
            latency_ms=(time.perf_counter() - started) * 1_000,
            usage=TokenUsage(
                input_tokens=int(usage.input_tokens or 0),
                cached_input_tokens=cached_tokens,
                output_tokens=int(usage.output_tokens or 0),
            ),
        )


class SupervisorState(TypedDict):
    request: dict[str, object]
    status: str
    model_call_count: int
    output_tokens_used: int
    call_records: list[dict[str, object]]
    errors: list[str]
    plan: NotRequired[dict[str, object]]
    requirements_result: NotRequired[dict[str, object]]
    risk_result: NotRequired[dict[str, object]]
    final_result: NotRequired[dict[str, object]]


class SupervisorBudgetExceeded(RuntimeError):
    pass


def estimate_luna_cost(usage: TokenUsage) -> float:
    cached = min(usage.input_tokens, usage.cached_input_tokens)
    uncached = usage.input_tokens - cached
    return (
        uncached * LUNA_INPUT_USD_PER_MILLION
        + cached * LUNA_CACHED_INPUT_USD_PER_MILLION
        + usage.output_tokens * LUNA_OUTPUT_USD_PER_MILLION
    ) / 1_000_000


def _request(state: SupervisorState) -> SupervisorRequest:
    return SupervisorRequest.model_validate(state["request"])


def _call_model[OutputT: StrictModel](
    state: SupervisorState,
    model: StructuredModel,
    *,
    stage: str,
    schema: type[OutputT],
    system_prompt: str,
    user_payload: dict[str, object],
    stage_output_cap: int,
) -> tuple[OutputT, ModelCallRecord]:
    request = _request(state)
    if state["model_call_count"] >= request.max_model_calls:
        raise SupervisorBudgetExceeded("max_model_calls exhausted before " + stage)
    remaining = request.max_output_tokens - state["output_tokens_used"]
    if remaining <= 0:
        raise SupervisorBudgetExceeded("max_output_tokens exhausted before " + stage)

    response = model.generate(
        stage=stage,
        schema=schema,
        system_prompt=system_prompt,
        user_payload=user_payload,
        max_output_tokens=min(stage_output_cap, remaining),
    )
    if response.usage.output_tokens > remaining:
        raise SupervisorBudgetExceeded("provider usage exceeded reserved output-token budget")
    record = ModelCallRecord(
        stage=stage,
        model=response.model,
        latency_ms=response.latency_ms,
        usage=response.usage,
        estimated_cost_usd=estimate_luna_cost(response.usage),
    )
    return response.output, record


def _budget_failure(state: SupervisorState, error: SupervisorBudgetExceeded) -> dict[str, object]:
    return {
        "status": SupervisorStatus.BUDGET_EXCEEDED.value,
        "errors": [*state["errors"], str(error)],
    }


ORCHESTRATOR_PROMPT = """You are the bounded main orchestrator for a freelance software project.
Decompose the supplied request into exactly two objectives: requirements analysis and risk analysis.
Do not perform either analysis, answer the user, call tools, or add facts. Preserve the user's scope.
Return only the requested structured plan and a concise policy rationale. Never expose chain-of-thought."""

REQUIREMENTS_PROMPT = """You are the Requirements Supervisor for a freelance software project.
Convert only the supplied user request and project context into testable functional, non-functional,
and constraint requirements. Quote the source when explicit; mark inferred content as assumptions.
Do not invent features, prices, schedules, laws, database facts, or external evidence. Record missing
information as unresolved questions. Return only the requested structured output."""

RISK_PROMPT = """You are the Risk Supervisor. Inspect the original request and structured requirements
for security, privacy, authorization, legal/contract, operational, dependency, and delivery risks.
Do not make final legal conclusions. Do not claim external evidence was checked. A risk unsupported by
the supplied material must be explicitly described as an assumption. Mark high-impact decisions or
missing authorization for human review. Return only the requested structured output."""

FINALIZER_PROMPT = """You are the final verifier and merger. Preserve requirement and risk identifiers.
Do not invent, silently resolve, or rewrite specialist findings. If material information is missing,
return NEEDS_CLARIFICATION. If any risk requires human review, return HUMAN_REQUIRED. Otherwise return
COMPLETED. The user_message must be readable Korean, concise, and include the decision, key findings,
open questions, and next action. Never expose private chain-of-thought."""


def build_supervisor_graph(model: StructuredModel) -> Any:
    """Build the fixed four-call Supervisor graph with no backward transitions."""

    def orchestrate(state: SupervisorState) -> dict[str, object]:
        request = _request(state)
        try:
            output, record = _call_model(
                state,
                model,
                stage="main_orchestrator",
                schema=SupervisorPlan,
                system_prompt=ORCHESTRATOR_PROMPT,
                user_payload={
                    "requirement_text": request.requirement_text,
                    "project_context": request.project_context,
                    "locale": request.locale,
                    "route_history": request.route_history,
                },
                stage_output_cap=512,
            )
        except SupervisorBudgetExceeded as error:
            return _budget_failure(state, error)
        return {
            "plan": output.model_dump(mode="json"),
            "model_call_count": state["model_call_count"] + 1,
            "output_tokens_used": state["output_tokens_used"] + record.usage.output_tokens,
            "call_records": [*state["call_records"], record.model_dump(mode="json")],
        }

    def analyze_requirements(state: SupervisorState) -> dict[str, object]:
        request = _request(state)
        try:
            output, record = _call_model(
                state,
                model,
                stage="requirements_supervisor",
                schema=RequirementsResult,
                system_prompt=REQUIREMENTS_PROMPT,
                user_payload={
                    "objective": state["plan"]["requirements_objective"],
                    "requirement_text": request.requirement_text,
                    "project_context": request.project_context,
                },
                stage_output_cap=1_536,
            )
        except SupervisorBudgetExceeded as error:
            return _budget_failure(state, error)
        return {
            "requirements_result": output.model_dump(mode="json"),
            "model_call_count": state["model_call_count"] + 1,
            "output_tokens_used": state["output_tokens_used"] + record.usage.output_tokens,
            "call_records": [*state["call_records"], record.model_dump(mode="json")],
        }

    def analyze_risks(state: SupervisorState) -> dict[str, object]:
        request = _request(state)
        try:
            output, record = _call_model(
                state,
                model,
                stage="risk_supervisor",
                schema=RiskResult,
                system_prompt=RISK_PROMPT,
                user_payload={
                    "objective": state["plan"]["risk_objective"],
                    "requirement_text": request.requirement_text,
                    "requirements_result": state["requirements_result"],
                },
                stage_output_cap=1_024,
            )
        except SupervisorBudgetExceeded as error:
            return _budget_failure(state, error)
        return {
            "risk_result": output.model_dump(mode="json"),
            "model_call_count": state["model_call_count"] + 1,
            "output_tokens_used": state["output_tokens_used"] + record.usage.output_tokens,
            "call_records": [*state["call_records"], record.model_dump(mode="json")],
        }

    def finalize(state: SupervisorState) -> dict[str, object]:
        try:
            output, record = _call_model(
                state,
                model,
                stage="final_verifier",
                schema=FinalSupervisorResult,
                system_prompt=FINALIZER_PROMPT,
                user_payload={
                    "plan": state["plan"],
                    "requirements_result": state["requirements_result"],
                    "risk_result": state["risk_result"],
                },
                stage_output_cap=1_024,
            )
        except SupervisorBudgetExceeded as error:
            return _budget_failure(state, error)
        return {
            "final_result": output.model_dump(mode="json"),
            "status": output.status,
            "model_call_count": state["model_call_count"] + 1,
            "output_tokens_used": state["output_tokens_used"] + record.usage.output_tokens,
            "call_records": [*state["call_records"], record.model_dump(mode="json")],
        }

    def route_or_end(next_node: str) -> Callable[[SupervisorState], str]:
        def route(state: SupervisorState) -> str:
            return "end" if state["status"] == SupervisorStatus.BUDGET_EXCEEDED else next_node

        return route

    builder: StateGraph[SupervisorState, None, SupervisorState, SupervisorState] = StateGraph(SupervisorState)
    builder.add_node("main_orchestrator", cast(Any, orchestrate))
    builder.add_node("requirements_supervisor", cast(Any, analyze_requirements))
    builder.add_node("risk_supervisor", cast(Any, analyze_risks))
    builder.add_node("final_verifier", cast(Any, finalize))
    builder.add_edge(START, "main_orchestrator")
    builder.add_conditional_edges(
        "main_orchestrator",
        route_or_end("requirements_supervisor"),
        {"requirements_supervisor": "requirements_supervisor", "end": END},
    )
    builder.add_conditional_edges(
        "requirements_supervisor",
        route_or_end("risk_supervisor"),
        {"risk_supervisor": "risk_supervisor", "end": END},
    )
    builder.add_conditional_edges(
        "risk_supervisor",
        route_or_end("final_verifier"),
        {"final_verifier": "final_verifier", "end": END},
    )
    builder.add_edge("final_verifier", END)
    return builder.compile()


class _GraphOnlyModel:
    """Compile-time placeholder that prevents accidental provider calls."""

    def generate[OutputT: StrictModel](
        self,
        *,
        stage: str,
        schema: type[OutputT],
        system_prompt: str,
        user_payload: dict[str, object],
        max_output_tokens: int,
    ) -> StructuredResponse[OutputT]:
        del stage, schema, system_prompt, user_payload, max_output_tokens
        raise RuntimeError("Graph rendering must not execute a model")


def export_compiled_supervisor_graph(
    output_dir: str | Path,
    *,
    render_png: bool = False,
) -> SupervisorGraphArtifacts:
    """Export Mermaid, local SVG, and optionally PNG from the compiled graph.

    The graph is compiled with a provider-free placeholder, so this operation
    neither requires ``OPENAI_API_KEY`` nor incurs model cost. SVG is rendered
    locally from the compiled nodes and edges. Optional PNG rendering uses
    LangGraph's Mermaid renderer and may contact its configured rendering service.
    """

    target_dir = Path(output_dir).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    drawable_graph = build_supervisor_graph(_GraphOnlyModel()).get_graph()
    mermaid_path = target_dir / "supervisor_graph.mmd"
    mermaid_path.write_text(drawable_graph.draw_mermaid(), encoding="utf-8")
    svg_path = target_dir / "supervisor_graph.svg"
    svg_path.write_text(_render_graph_svg(drawable_graph), encoding="utf-8")

    png_path: Path | None = None
    if render_png:
        png_path = target_dir / "supervisor_graph.png"
        try:
            drawable_graph.draw_mermaid_png(output_file_path=str(png_path))
        except Exception as error:
            raise RuntimeError(f"Mermaid source was saved to {mermaid_path}, but PNG rendering failed") from error

    return SupervisorGraphArtifacts(
        mermaid_path=mermaid_path,
        svg_path=svg_path,
        png_path=png_path,
    )


def _render_graph_svg(drawable_graph: Any) -> str:
    """Render a dependency-free reference diagram from compiled graph metadata."""

    node_ids = list(drawable_graph.nodes)
    width = 1_100
    height = max(680, 120 + len(node_ids) * 110)
    node_width = 330
    node_height = 58
    center_x = 370
    first_y = 70
    vertical_gap = 110
    positions = {node_id: (center_x, first_y + index * vertical_gap) for index, node_id in enumerate(node_ids)}
    end_id = "__end__"
    early_end_index = 0
    edge_markup: list[str] = []

    for edge in drawable_graph.edges:
        source_x, source_y = positions[edge.source]
        target_x, target_y = positions[edge.target]
        edge_class = "conditional" if edge.conditional else "direct"
        label = escape(str(edge.data)) if edge.data is not None else ""
        label_x: float
        label_y: float

        if edge.target == end_id and edge.source != "final_verifier":
            lane_x = 650 + early_end_index * 90
            early_end_index += 1
            path = (
                f"M {source_x + node_width / 2} {source_y} "
                f"L {lane_x} {source_y} L {lane_x} {target_y} "
                f"L {target_x + node_width / 2} {target_y}"
            )
            label_x = lane_x + 8
            label_y = source_y - 8
        else:
            path = f"M {source_x} {source_y + node_height / 2} L {target_x} {target_y - node_height / 2}"
            label_x = source_x + 12
            label_y = (source_y + target_y) / 2 - 8

        edge_markup.append(f'<path class="edge {edge_class}" d="{path}" marker-end="url(#arrow)"/>')
        if label:
            edge_markup.append(f'<text class="edge-label" x="{label_x}" y="{label_y}">{label}</text>')

    node_markup: list[str] = []
    for node_id, (x, y) in positions.items():
        css_class = "terminal" if node_id in {"__start__", "__end__"} else "stage"
        label = "START" if node_id == "__start__" else "END" if node_id == "__end__" else node_id
        node_markup.extend(
            [
                (
                    f'<rect class="node {css_class}" x="{x - node_width / 2}" '
                    f'y="{y - node_height / 2}" width="{node_width}" height="{node_height}" rx="16"/>'
                ),
                f'<text class="node-label" x="{x}" y="{y + 6}">{escape(label)}</text>',
            ]
        )

    return "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            (
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
                f'viewBox="0 0 {width} {height}" role="img" aria-labelledby="title description">'
            ),
            '<title id="title">Compiled Supervisor LangGraph</title>',
            (
                '<desc id="description">Main orchestrator, requirements supervisor, risk supervisor, '
                "and final verifier with budget-exit paths.</desc>"
            ),
            "<defs>",
            (
                '<marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" '
                'orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#64748b"/></marker>'
            ),
            "</defs>",
            "<style>",
            "svg { background: #0b1020; }",
            ".node { stroke-width: 2; }",
            ".stage { fill: #172033; stroke: #60a5fa; }",
            ".terminal { fill: #132e2b; stroke: #34d399; }",
            (
                ".node-label { fill: #f8fafc; font: 600 18px ui-monospace, SFMono-Regular, Consolas, monospace; "
                "text-anchor: middle; }"
            ),
            ".edge { fill: none; stroke: #64748b; stroke-width: 2.5; }",
            ".conditional { stroke-dasharray: 8 6; }",
            (".edge-label { fill: #fbbf24; font: 600 15px ui-monospace, SFMono-Regular, Consolas, monospace; }"),
            "</style>",
            *edge_markup,
            *node_markup,
            "</svg>",
            "",
        ]
    )


def initial_state(request: SupervisorRequest) -> SupervisorState:
    return {
        "request": request.model_dump(mode="json"),
        "status": SupervisorStatus.RUNNING.value,
        "model_call_count": 0,
        "output_tokens_used": 0,
        "call_records": [],
        "errors": [],
    }


def run_supervisor(request: SupervisorRequest, model: StructuredModel) -> dict[str, object]:
    result = build_supervisor_graph(model).invoke(initial_state(request))
    records = [ModelCallRecord.model_validate(item) for item in result["call_records"]]
    return {
        "run_id": str(request.run_id),
        "prompt_version": PROMPT_VERSION,
        "output_schema_version": OUTPUT_SCHEMA_VERSION,
        "model": DEFAULT_MODEL,
        "status": result["status"],
        "model_call_count": result["model_call_count"],
        "output_tokens_used": result["output_tokens_used"],
        "estimated_cost_usd": sum(record.estimated_cost_usd for record in records),
        "call_records": [record.model_dump(mode="json") for record in records],
        "plan": result.get("plan"),
        "requirements_result": result.get("requirements_result"),
        "risk_result": result.get("risk_result"),
        "final_result": result.get("final_result"),
        "errors": result["errors"],
    }


def run_live(requirement_text: str, project_context: str = "") -> dict[str, object]:
    """Explicit paid smoke-test entry point; never called by pytest or module import."""

    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is required for a live Supervisor run")
    request = SupervisorRequest(
        requirement_text=requirement_text,
        project_context=project_context,
    )
    return run_supervisor(request, OpenAIResponsesModel())


class FakeStructuredModel:
    """Deterministic queue-backed model used by tests without network or API cost."""

    def __init__(self, outputs: Sequence[StrictModel], tokens_per_call: int = 10) -> None:
        self._outputs = list(outputs)
        self.tokens_per_call = tokens_per_call
        self.stages: list[str] = []
        self.caps: list[int] = []

    def generate[OutputT: StrictModel](
        self,
        *,
        stage: str,
        schema: type[OutputT],
        system_prompt: str,
        user_payload: dict[str, object],
        max_output_tokens: int,
    ) -> StructuredResponse[OutputT]:
        del system_prompt, user_payload
        if not self._outputs:
            raise AssertionError("No fake output remains")
        output = self._outputs.pop(0)
        if not isinstance(output, schema):
            raise AssertionError(f"{stage} expected {schema.__name__}, got {type(output).__name__}")
        self.stages.append(stage)
        self.caps.append(max_output_tokens)
        return StructuredResponse[OutputT](
            output=output,
            model=DEFAULT_MODEL,
            latency_ms=1.0,
            usage=TokenUsage(
                input_tokens=100,
                cached_input_tokens=20,
                output_tokens=self.tokens_per_call,
            ),
        )


def _main() -> None:
    parser = argparse.ArgumentParser(description="Export the compiled Supervisor LangGraph")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).with_name("artifacts"),
        help="Artifact directory (default: tests/model_test/artifacts)",
    )
    parser.add_argument(
        "--render-png",
        action="store_true",
        help="Also render PNG through LangGraph's configured Mermaid renderer",
    )
    args = parser.parse_args()
    artifacts = export_compiled_supervisor_graph(
        args.output_dir,
        render_png=args.render_png,
    )
    print(json.dumps(artifacts.model_dump(mode="json"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    _main()
