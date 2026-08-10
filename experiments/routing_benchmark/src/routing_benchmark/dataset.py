from __future__ import annotations

import random
from dataclasses import asdict, dataclass
from typing import Any

SUPRA_DATASET = "SupraLabs/Prompt-Routing-Dataset"
SUPRA_REVISION = "458d9f67018a350ee84bfd5e936aeca6f2522341"
ORCHESTRATION_DATASET = "rescommons/agent-orchestration-dataset"
ORCHESTRATION_REVISION = "a6f62525d440030983dba2a61671d0e48177c100"

# These indices were reviewed against the V2 execution policy using only the
# visible user prompt. The datasets' original labels are deliberately not
# translated into product routes.
SIMPLE_SUPRA_INDICES = (3, 5, 7, 19, 30, 32, 36, 40, 46, 50)
REACT_ORCHESTRATION_INDICES = (0, 3, 5, 9, 10, 13, 17, 18, 22, 74)
HUMAN_ORCHESTRATION_INDICES = (1, 4, 11, 12, 15, 19, 21, 23, 76, 90)


@dataclass(frozen=True)
class RoutingCase:
    id: str
    prompt: str
    expected_route: str
    source_dataset: str
    source_split: str
    source_index: int
    mapping_rule: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


DIRECT_TOOL_FIXTURES = [
    "Calculate the subtotal, 10% VAT, and total for 12 hours at 80,000 KRW per hour.",
    "Convert 3.5 working days to hours using exactly 8 hours per day.",
    "Add these approved line items without changing them: 120000, 45000, and 33500 KRW.",
    "Apply the supplied 5% discount to 2,000,000 KRW and return the exact final amount.",
    "Look up project P-104 in the supplied project table and return its stored status only.",
    "Calculate the difference in days between 2026-09-01 and 2026-09-15.",
    "Multiply the fixed unit price 37,500 KRW by the confirmed quantity 24.",
    "Return the current workspace's stored currency code from the provided structured context.",
    "Calculate a 30% deposit on the already approved total of 4,500,000 KRW.",
    "Sum the confirmed development hours: planning 8, implementation 32, testing 12.",
]

SUPERVISOR_FIXTURES = [
    (
        "신규 고객의 상담 기록에서 요구사항을 정리하고, CRM 고객 정보를 확인한 뒤, "
        "프로젝트 초안과 근거가 포함된 견적 초안을 함께 만들어 주세요."
    ),
    (
        "Review the client's uploaded brief, identify missing requirements, estimate the work "
        "with the pricing specialist, and have compliance verify the contract constraints."
    ),
    (
        "기존 고객의 변경 요청이 계약 범위에 포함되는지 검토하고, 개발 일정 영향과 추가 "
        "비용을 각각 산정하여 하나의 변경 제안서로 합쳐 주세요."
    ),
    (
        "Analyze the discovery call, ask the requirements team to define scope, ask delivery to "
        "build a milestone plan, and merge both outputs into a client-ready proposal."
    ),
    (
        "고객이 보낸 기능 목록을 보안·개발·디자인 관점에서 각각 검토하고, 충돌하는 "
        "의견을 조정하여 최종 실행 계획을 작성해 주세요."
    ),
    (
        "Check the CRM history and previous quote, then coordinate requirements and finance to "
        "prepare a revised scope, schedule, and price with evidence for every change."
    ),
    (
        "프로젝트 지연 원인을 개발 기록과 고객 커뮤니케이션에서 각각 조사하고, 일정 "
        "복구안과 고객 안내문을 부서별로 작성한 뒤 통합해 주세요."
    ),
    (
        "Have legal review the NDA, delivery assess technical feasibility, and finance calculate "
        "the commercial impact before producing one go/no-go recommendation."
    ),
    (
        "문의 내용을 요구사항, 기술 위험, 예상 공수로 나누어 담당 에이전트에게 검토시키고, "
        "서로 의존하는 결과를 반영한 최종 견적 보고서를 만들어 주세요."
    ),
    (
        "Compare the client's requested launch date with engineering capacity, validate the "
        "budget with finance, and coordinate a feasible phased delivery proposal."
    ),
]


def _user_prompt(messages: list[dict[str, str]]) -> str:
    for message in messages:
        if message["role"] == "user":
            return message["content"].strip()
    raise ValueError("Orchestration row does not contain a user message")


def _fixture_cases(prompts: list[str], route: str, rule: str) -> list[RoutingCase]:
    return [
        RoutingCase(
            id=f"{route.lower()}-project-{index}",
            prompt=prompt,
            expected_route=route,
            source_dataset="Freelance-Ops-Agent V2 routing policy",
            source_split="fixture",
            source_index=index,
            mapping_rule=rule,
        )
        for index, prompt in enumerate(prompts)
    ]


def build_routing_cases(samples_per_route: int, seed: int) -> list[RoutingCase]:
    """Build the frozen, human-reviewed V2 policy benchmark."""
    from datasets import load_dataset

    if samples_per_route != 10:
        raise ValueError("The reviewed gold set is frozen at exactly 10 cases per route")

    supra = load_dataset(
        SUPRA_DATASET,
        revision=SUPRA_REVISION,
        split="train",
    )
    orchestration = load_dataset(
        ORCHESTRATION_DATASET,
        revision=ORCHESTRATION_REVISION,
        split="train",
    )

    simple = [
        RoutingCase(
            id=f"simple-supra-{index}",
            prompt=supra[index]["prompt"].strip(),
            expected_route="SIMPLE_LLM",
            source_dataset=SUPRA_DATASET,
            source_split="train",
            source_index=index,
            mapping_rule="human-reviewed: single language generation call; no tool or delegation",
        )
        for index in SIMPLE_SUPRA_INDICES
    ]
    react = [
        RoutingCase(
            id=f"react-orchestration-{index}",
            prompt=_user_prompt(orchestration[index]["messages"]),
            expected_route="REACT_AGENT",
            source_dataset=ORCHESTRATION_DATASET,
            source_split="train",
            source_index=index,
            mapping_rule="human-reviewed: bounded transactional or incident workflow using tools",
        )
        for index in REACT_ORCHESTRATION_INDICES
    ]
    human = [
        RoutingCase(
            id=f"human-orchestration-{index}",
            prompt=_user_prompt(orchestration[index]["messages"]),
            expected_route="HUMAN_REQUIRED",
            source_dataset=ORCHESTRATION_DATASET,
            source_split="train",
            source_index=index,
            mapping_rule="human-reviewed: leave approval or identity-document verification",
        )
        for index in HUMAN_ORCHESTRATION_INDICES
    ]
    direct = _fixture_cases(
        DIRECT_TOOL_FIXTURES,
        "DIRECT_TOOL",
        "V2 policy fixture: one exact deterministic calculation or structured lookup",
    )
    supervisor = _fixture_cases(
        SUPERVISOR_FIXTURES,
        "SUPERVISOR",
        "V2 policy fixture: explicit multi-department coordination and synthesis",
    )

    cases = direct + simple + react + supervisor + human
    rng = random.Random(seed)
    rng.shuffle(cases)
    return cases
