"""Actual FastAPI/OperationalAgentExecutor/PG; only model generation is synthetic."""

import asyncio
import json
import os
import selectors
import sys
from pathlib import Path
from urllib.parse import urlparse

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
for name in (
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "TAVILY_API_KEY",
    "LANGSMITH_API_KEY",
    "LANGCHAIN_API_KEY",
):
    os.environ.pop(name, None)
os.environ.update(
    {
        "AGENT_ENVIRONMENT": "test",
        "AGENT_BACKEND_INTERNAL_URL": "http://127.0.0.1:18221",
        "AGENT_DATABASE_URL": os.environ.get(
            "LIVE_DATABASE_URL", "postgresql://app_user@127.0.0.1:18222/freelance_ops"
        ),
        "AGENT_RUN_STORE_BACKEND": "postgres",
        "AGENT_CHECKPOINT_BACKEND": "postgres",
        "AGENT_WEB_RESEARCH_ENABLED": "false",
        "LANGSMITH_TRACING": "false",
        "AGENT_DELEGATION_TOKEN_PUBLIC_KEY": Path(sys.argv[1]).read_text(),
    }
)

database_url = os.environ["AGENT_DATABASE_URL"]
target = urlparse(database_url)
if target.hostname != "127.0.0.1" or not 18200 <= target.port <= 18249:
    raise RuntimeError(
        "Use an isolated loopback test database on the allocated port range"
    )
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "agent" / "src"))

import main
import uvicorn
from providers import ModelGeneration, ProviderCallError

calls = []
evidence = Path(sys.argv[1]).resolve().with_name("synthetic-model-calls.json")


def drafts():
    return [
        {
            "scenario": scenario,
            "items": [
                {
                    "title": f"LIVE_{scenario}",
                    "description": "합성 모델의 범위 제안",
                    "quantity": index + 1,
                    "unit": "DAY",
                    "basis": {
                        "type": "ASSUMPTION",
                        "content": "사용자 검토가 필요한 합성 가정",
                    },
                }
            ],
            "pet_perspective": {
                "proposal": f"LIVE_{scenario} 선택 제안",
                "rationale": f"{scenario} 일정과 범위의 합성 근거",
                "tradeoff": "범위와 일정 조건을 확인해야 합니다.",
            },
        }
        for index, scenario in enumerate(("LEAN", "RECOMMENDED", "EXPANDED"))
    ]


class SyntheticModelProvider:
    async def generate_structured(
        self, selection, prompt, *, max_output_tokens, max_attempts=None
    ):
        return self.generate(prompt, False)

    async def generate_react_step(
        self, selection, prompt, *, max_output_tokens, max_attempts=None
    ):
        return self.generate(prompt, True)

    def generate(self, prompt, react):
        document = json.loads(prompt)
        objective = document.get("objective", document)
        full = objective.get("workflow_mode") == "PROJECT_ANALYSIS"
        department = objective.get("department")
        resumed = "Authenticated user clarification data" in prompt
        partial = "LIVE_PARTIAL_FAILURE" in prompt and department == "DEAL_DESIGN"
        calls.append(
            {
                "mode": "PROJECT_ANALYSIS" if full else "AD_HOC",
                "department": department,
                "resumed": resumed,
                "react": react,
                "failed": partial,
            }
        )
        evidence.write_text(
            json.dumps(
                {
                    "boundary": "external model provider only",
                    "actualProviderRequests": 0,
                    "calls": calls,
                },
                indent=2,
            )
        )
        if partial:
            raise ProviderCallError(
                "synthetic department failure",
                model_calls=1,
                input_tokens=10,
                output_tokens=0,
            )
        payload = {
            "summary": "LIVE 합성 모델 응답: 실제 서버와 저장소 워크플로우 검증",
            "open_questions": ["고객이 제공할 자료와 제외할 기능을 알려 주세요."]
            if full and not resumed
            else [],
            "quotation_drafts": drafts() if full else [],
        }
        if react:
            payload.update({"action": "FINAL", "arguments": {}})
        return ModelGeneration(
            payload=payload, input_tokens=10, output_tokens=10, model_calls=1
        )


# Adapter replacement is the sole double. HTTP routers, JWT verifier, tools,
# coordinator, persistence, checkpoints, projection and Spring services are real.
main.CompositeModelProvider = lambda *args: SyntheticModelProvider()
app = main.create_app()
server = uvicorn.Server(
    uvicorn.Config(app, host="127.0.0.1", port=18223, access_log=False)
)
asyncio.run(
    server.serve(),
    loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()),
)
