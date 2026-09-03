"""Pre-registered read-only Research specialist with independent evidence verification."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import re
from collections.abc import Sequence
from dataclasses import dataclass
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field

from contracts import DepartmentName, DepartmentResult, SourceReference
from providers import ProviderCallError
from routing.profiles import ToolProfile
from web_research import ResearchCollection, WebResearchBudgetError

from .executor import ResearchTool
from .react_loop import BoundedReActLoop, ReActLoopBudget, ReActLoopError, ReActStepProvider, StructuredTool
from .task_contracts import DepartmentTask, ExecutionRoute

_CITATION = re.compile(r"\[source:(\d+)]")


class ResearchSpecialistError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class ResearchQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=2, max_length=2000)


class ResearchSpecialistResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    department_result: DepartmentResult
    model_calls: int = Field(ge=1)
    tool_calls: int = Field(ge=1)
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    search_credits: int = Field(default=0, ge=0)
    citation_count: int = Field(ge=1)
    verification_status: str = Field(pattern="^PASSED$")
    specialist_profile: str = Field(pattern="^research-read-v1$")


@dataclass(frozen=True, slots=True)
class VerifiedResearch:
    sources: list[SourceReference]
    citation_count: int


class ResearchResultVerifier:
    """Verifies evidence independently from the model that produced the summary."""

    def verify(self, summary: str, sources: Sequence[SourceReference]) -> VerifiedResearch:
        citations = [int(value) for value in _CITATION.findall(summary)]
        if not summary.strip() or not citations:
            raise ResearchSpecialistError("RESEARCH_EVIDENCE_REQUIRED")
        paragraphs = [paragraph.strip() for paragraph in summary.splitlines() if paragraph.strip()]
        if any(_CITATION.search(paragraph) is None for paragraph in paragraphs):
            raise ResearchSpecialistError("RESEARCH_UNCITED_CLAIM")
        if not sources or any(index < 1 or index > len(sources) for index in citations):
            raise ResearchSpecialistError("RESEARCH_CITATION_INVALID")
        selected_indexes = list(dict.fromkeys(citations))
        selected = [sources[index - 1] for index in selected_indexes]
        if len({source.content_sha256 for source in selected}) != len(selected):
            raise ResearchSpecialistError("RESEARCH_EVIDENCE_DUPLICATED")
        if any(not self._valid_source(source) for source in selected):
            raise ResearchSpecialistError("RESEARCH_EVIDENCE_INVALID")
        return VerifiedResearch(sources=selected, citation_count=len(citations))

    @staticmethod
    def _valid_source(source: SourceReference) -> bool:
        parsed = urlsplit(source.url)
        return parsed.scheme in {"http", "https"} and bool(parsed.hostname) and source.fetched_at.tzinfo is not None and source.fetched_at.utcoffset() is not None and source.authority_level in {"OFFICIAL", "PRIMARY", "SECONDARY", "UNKNOWN"}


class ReadOnlyResearchSpecialist:
    PROFILE = "research-read-v1"

    def __init__(self, provider: ReActStepProvider, research_tool: ResearchTool, verifier: ResearchResultVerifier | None = None) -> None:
        self._provider = provider
        self._research_tool = research_tool
        self._verifier = verifier or ResearchResultVerifier()

    async def execute(self, task: DepartmentTask, *, objective: str, jurisdiction: str | None = None) -> ResearchSpecialistResult:
        self._require_contract(task, objective)
        collections: list[ResearchCollection] = []

        async def collect(arguments: BaseModel) -> ResearchCollection:
            query = ResearchQuery.model_validate(arguments.model_dump(mode="json"))
            remaining_search_credits = task.execution.budget.max_search_credits - sum(item.search_credits for item in collections)
            remaining_tool_calls = task.execution.budget.max_tool_calls - sum(item.tool_calls for item in collections)
            collection = await self._research_tool.collect(query.query, jurisdiction, remaining_search_credits, remaining_tool_calls)
            if collection.search_credits > remaining_search_credits or collection.tool_calls > remaining_tool_calls:
                raise ResearchSpecialistError("RESEARCH_USAGE_EXCEEDED")
            collections.append(collection)
            return collection

        def observation(collection: object) -> object:
            assert isinstance(collection, ResearchCollection)
            sources = self._unique_sources(collections)
            return {
                "sources": [{"source_id": index, **source.model_dump(mode="json")} for index, source in enumerate(sources, start=1)],
                "search_credits": collection.search_credits,
                "tool_calls": collection.tool_calls,
                "fetched_pages": collection.fetched_pages
            }

        tool = StructuredTool(name="web_research", description="Search and fetch allowlisted public sources without side effects.", input_model=ResearchQuery, handler=collect, sanitize_observation=observation, call_cost=self._tool_cost)
        loop = BoundedReActLoop(self._provider, [tool])
        budget = task.execution.budget
        objective_payload = {
            "task_id": str(task.task_id),
            "task_revision": task.revision,
            "objective": objective,
            "jurisdiction": jurisdiction,
            "output_contract": {
                "summary_must_cite_evidence": "Use [source:N] markers from web_research observations.",
                "no_uncited_factual_claims": True
            }
        }
        loop_budget = ReActLoopBudget(max_model_calls=budget.max_model_calls, max_tool_calls=budget.max_tool_calls, max_input_tokens=budget.max_input_tokens, max_output_tokens=budget.max_output_tokens, max_retries=budget.max_retries)
        try:
            async with asyncio.timeout(budget.max_duration_seconds):
                result = await loop.run(task.execution.model_selection, objective_payload, loop_budget)
        except TimeoutError as error:
            raise ResearchSpecialistError("RESEARCH_DURATION_BUDGET_EXCEEDED") from error
        except WebResearchBudgetError as error:
            raise ResearchSpecialistError(str(error)) from error
        except ReActLoopError as error:
            raise ResearchSpecialistError(error.code) from error
        except ProviderCallError as error:
            raise ResearchSpecialistError("MODEL_PROVIDER_FAILED") from error
        except ResearchSpecialistError:
            raise
        except (RuntimeError, ValueError) as error:
            raise ResearchSpecialistError("RESEARCH_EXECUTION_FAILED") from error

        sources = self._unique_sources(collections)
        verified = self._verifier.verify(result.summary, sources)
        department_result = DepartmentResult(department=DepartmentName.RESEARCH, status="COMPLETED", summary=result.summary, sources=verified.sources)
        return ResearchSpecialistResult(department_result=department_result, model_calls=result.model_calls, tool_calls=result.tool_calls, input_tokens=result.input_tokens, output_tokens=result.output_tokens, search_credits=sum(item.search_credits for item in collections), citation_count=verified.citation_count, verification_status="PASSED", specialist_profile=self.PROFILE)

    @classmethod
    def _require_contract(cls, task: DepartmentTask, objective: str) -> None:
        if task.department is not DepartmentName.RESEARCH:
            raise ResearchSpecialistError("RESEARCH_DEPARTMENT_REQUIRED")
        if task.execution.route not in {ExecutionRoute.REACT_AGENT, ExecutionRoute.SUPERVISOR}:
            raise ResearchSpecialistError("RESEARCH_ROUTE_NOT_ALLOWED")
        if task.execution.tool_profile is not ToolProfile.READ_ONLY:
            raise ResearchSpecialistError("RESEARCH_READ_ONLY_PROFILE_REQUIRED")
        if task.execution.specialist_profile != cls.PROFILE:
            raise ResearchSpecialistError("RESEARCH_SPECIALIST_PROFILE_NOT_ALLOWED")
        if not objective.strip() or len(objective) > 20_000:
            raise ResearchSpecialistError("RESEARCH_OBJECTIVE_INVALID")

    @staticmethod
    def _tool_cost(collection: object) -> int:
        assert isinstance(collection, ResearchCollection)
        return collection.tool_calls

    @staticmethod
    def _unique_sources(collections: Sequence[ResearchCollection]) -> list[SourceReference]:
        unique: dict[str, SourceReference] = {}
        for collection in collections:
            for source in collection.sources:
                unique.setdefault(source.content_sha256, source)
        return list(unique.values())[:10]
