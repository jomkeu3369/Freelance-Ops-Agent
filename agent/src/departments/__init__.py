"""부서별 Agent 실행 구성.

주의: 현재 `research_deep_agent` 는 개발·검증용 비교 후보이며 운영 실행기(`runtime/`, `api/`, `main.py`)에
직접 연결하지 않는다. 운영 경로와의 경계는 `tests/test_architecture_rules.py` 로 강제한다.
"""

from .research_deep_agent import ResearchOutput, build_research_deep_agent, research_filesystem_permissions

__all__ = ["ResearchOutput", "build_research_deep_agent", "research_filesystem_permissions"]