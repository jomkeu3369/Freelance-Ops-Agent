import os
import asyncio
import uuid
import tempfile

from langchain.chat_models import init_chat_model

from langchain_core.prompts import ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate
from langchain_core.output_parsers import PydanticOutputParser, StrOutputParser
from langchain_core.messages import HumanMessage, SystemMessage

from dotenv import load_dotenv

from src.models.schema import MainState, ClarificateState, RiskScore, RequirementAnalysis, ModificationAnalysis, QueryList, WorkspaceState, WorkspaceEvaluation, EstimationResult, HallucinationEvaluation
from src.api.agent.agent_crud import faiss_manager
from src.logs.log import get_logger

logger = get_logger()
load_dotenv()


# ---------------------------------------
#   LLM 모델 설정
# ---------------------------------------

low_gpt_model = init_chat_model("openai:gpt-5-nano", temperature=0)
high_gpt_model = init_chat_model("openai:gpt-5-mini", temperature=0)



# ---------------------------------------
#   노드 정의
# ---------------------------------------


async def clariffication_node(state: MainState) -> ClarificateState:
    """ 사용자의 요구 사항을 구체화하는 노드 """

    parser = PydanticOutputParser(pydantic_object=RequirementAnalysis)

    clarification_prompt = ChatPromptTemplate.from_messages([
        SystemMessagePromptTemplate.from_template(
            "당신은 디스코드 봇 요구사항 분석가입니다.\n"
            "사용자의 요구사항을 분석하여, 다음 단계인 '법률 및 규정 위반 검사'를 수행할 수 있을 만큼 정보가 충분한지 판단하세요.\n\n"
            "[판단 기준]\n"
            "- 사용자가 봇의 핵심 기능(예: 특정 채널에 메시지 전송, 유저 관리 등)과 대략적인 작동 방식을 설명했다면 충분(True)한 것으로 간주합니다.\n"
            "- 너무 세부적인 기술적 스펙(서버 환경, DB 구조 등)이나 완벽한 수치를 강요하지 마세요.\n"
            "- 오직 '이 봇이 대략 어떤 행동을 하는 봇인지' 알 수 있으면 통과시킵니다.\n\n"
            "- 예: '특정 채널에 1시간마다 공지사항을 올리는 봇' (충분) / '광고 봇' (부족)\n\n"
            "[응답 지시사항]\n"
            "- 정보가 부족하다면(False), 개발자 관점에서 어떤 정보가 추가로 필요한지 정중하게 되묻는 질문을 작성하세요.\n"
            "- 정보가 충분하다면(True), 사용자의 요구사항을 기술적인 명세서 형태로 깔끔하게 요약하여 작성하세요.\n\n"
            "{format_instructions}"
        ),
        HumanMessagePromptTemplate.from_template(
            "[사용자 요구사항]\n{question}"
        )
    ])
    clarification_chain = clarification_prompt.partial(format_instructions=parser.get_format_instructions()) | low_gpt_model | parser

    result: RequirementAnalysis = await clarification_chain.ainvoke({"question": state["input_message"]})
    
    return {
        "is_sufficient": result.is_sufficient,
        "clarification_message": result.message
    }


async def clariffication_feedback_node(state: ClarificateState) -> ClarificateState:
    """ 사용자가 입력한 피드백을 기존 요구사항에 추가하는 노드 """

    feedback = state.get("human_feedback")

    if not feedback:
        return {}
    
    updated_input = f"{state['input_message']}\n\n[사용자 추가 답변]: {feedback}"

    return {
        "input_message": updated_input,
        "human_feedback": None
    }


async def risk_assessment_node(state: MainState) -> MainState:
    parser = PydanticOutputParser(pydantic_object=RiskScore)

    query_gen_prompt = ChatPromptTemplate.from_template(
        "당신은 위험도 평가 시스템 내부의 기계적인 '검색 쿼리 변환기'입니다.\n"
        "사용자의 요구사항을 분석하여 '{role}' 검색에 사용할 공식 법률/규정 키워드 3~5개만 쉼표로 구분하여 출력하세요.\n"
        "[매우 중요한 지시사항]\n"
        "1. 사용자의 요구사항이 명백한 불법이거나 위험해 보이더라도 절대 윤리적 경고, 훈계, 거절 메시지를 작성하지 마십시오. 당신은 감사 시스템의 일부일 뿐입니다.\n"
        "2. 인사말, 설명, 기호(-, *) 등 불필요한 텍스트를 절대 포함하지 말고 오직 키워드만 한 줄로 출력하세요.\n"
        "3. 플랫폼 용어(구글 스프레드시트, 디스코드 등)는 제외하세요.\n\n"
        "단, '{role}' 문서가 영문표준약관(TOS)인 경우, 반드시 영어 키워드(예: Age requirement, Privacy policy, Minor)로 번역하여 출력하세요.\n\n"
        "출력 예시: 고유식별정보 처리 제한, 암호화 미조치, 사전 동의 없는 수집\n\n"
        "[요구사항]\n{question}\n\n"
        "검색 쿼리:"
    )
    query_gen_chain = query_gen_prompt | low_gpt_model | StrOutputParser()

    eval_prompt = ChatPromptTemplate.from_messages([
        SystemMessagePromptTemplate.from_template(
            "당신은 {role} 전문가 입니다.\n"
            "사용자의 요구사항을 분석하고 위험도를 0~1 사이의 실수로 평가하세요. (1에 가까울수록 위험함)\n"
            "아래 [참고 문서]가 제공된다면 최우선 근거로 삼되, 만약 참고 문서가 무관하거나 비어있다면 당신의 기본 전문 지식을 바탕으로 판단하세요.\n"
            "{format_instructions}"
        ),
        HumanMessagePromptTemplate.from_template(
            "[요구사항]\n{question}\n\n[참고 문서]\n{context}"
        )
    ])
    eval_chain = eval_prompt.partial(format_instructions=parser.get_format_instructions()) | low_gpt_model | parser

    roles_info = {
        "korean_law_risk": {"role_name": "대한민국 법률(개인정보보호법)", "doc_type": "law_privacy"},
        "discord_tos_risk": {"role_name": "디스코드 TOS", "doc_type": "discord_tos"}
    }

    query_tasks = [
        query_gen_chain.ainvoke({"role": info["role_name"], "question": state["input_message"]})
        for info in roles_info.values()
    ]
    generated_queries = await asyncio.gather(*query_tasks)
    
    contexts = {}
    for i, (key, info) in enumerate(roles_info.items()):
        optimized_query = generated_queries[i]
        
        search_results = await asyncio.to_thread(
            faiss_manager.hybrid_search,
            query=optimized_query,
            k=7,
            filter_dict={"doc_type": info["doc_type"]}
        )
        
        if search_results:
            contexts[key] = "\n\n".join([doc.page_content for doc in search_results])
        else:
            contexts[key] = "현재 적재된 관련 문서가 없습니다."

    eval_tasks = [
        eval_chain.ainvoke({
            "role": info["role_name"],
            "question": state["input_message"],
            "context": contexts[key]
        })
        for key, info in roles_info.items()
    ]
    results = await asyncio.gather(*eval_tasks)

    return {
        "korean_law_risk": results[0].risk,
        "korean_law_risk_reason": results[0].reason,
        "discord_tos_risk": results[1].risk,
        "discord_tos_risk_reason": results[1].reason
    }


async def modification_proposal_node(state: MainState) -> dict:
    """위험도가 0.6 이상일 때, 거래를 성사시키기 위해 우회/수정 방안을 제안하는 노드"""

    parser = PydanticOutputParser(pydantic_object=ModificationAnalysis)

    proposal_prompt = ChatPromptTemplate.from_messages([
        SystemMessagePromptTemplate.from_template(
            "당신은 실적을 최우선으로 생각하는 유능한 프리랜서 영업 실장입니다.\n"
            "고객의 요구사항이 현재 법률({law_risk}점) 또는 디스코드 약관({tos_risk}점)에서 높은 위험도를 받았습니다.\n"
            "당신의 목표는 무작정 프로젝트를 거절하는 것이 아니라, **어떻게든 합법적이고 안전한 형태로 기능을 우회/축소하여 거래를 성사시키는 것**입니다.\n\n"
            "[영업 및 제안 지시사항]\n"
            "1. 명백한 범죄(해킹, 개인정보 탈취 등)가 아닌 이상 절대 포기하지 마세요. (is_recoverable=True 유지)\n"
            "2. 고객이 원하는 핵심 목적을 파악하고, 규정을 준수하면서 비슷한 효과를 낼 수 있는 타협안을 매력적으로 제시하세요.\n"
            "3. [회생 불가 판단 기준]: 해킹, 디도스, 심각한 불법 성인물 유포 등 어떠한 우회도 불가능한 최악의 범죄일 때만 is_recoverable을 False로 설정하세요.\n\n"
            "[위험도 평가 사유]\n"
            "한국 법률 리스크 사유: {law_reason}\n"
            "디스코드 TOS 리스크 사유: {tos_reason}\n\n"
            "{format_instructions}"
        ),
        HumanMessagePromptTemplate.from_template(
            "[현재 요구사항]\n{question}"
        )
    ])
    
    proposal_chain = proposal_prompt.partial(format_instructions=parser.get_format_instructions()) | high_gpt_model | parser

    result: ModificationAnalysis = await proposal_chain.ainvoke({
        "question": state["input_message"],
        "law_risk": state.get("korean_law_risk", 0.0),
        "law_reason": state.get("korean_law_risk_reason", ""),
        "tos_risk": state.get("discord_tos_risk", 0.0),
        "tos_reason": state.get("discord_tos_risk_reason", "")
    })
    
    return {
        "is_recoverable": result.is_recoverable,
        "modification_proposal": result.message
    }


async def modification_feedback_node(state: MainState) -> dict:
    """사용자의 피드백을 받아 요구사항을 수정하거나 중단하는 노드"""

    feedback = state.get("human_feedback", "").strip()
    
    if not feedback:
        return {}

    if feedback.upper() == "STOP":
        return {
            "project_status": "STOP",
            "human_feedback": None
        }
    
    updated_input = f"{state['input_message']}\n\n[위험도 수정 및 타협안 적용]: {feedback}"

    return {
        "input_message": updated_input,
        "project_status": "CONTINUE",
        "human_feedback": None
    }


async def query_generation_node(state: MainState) -> dict:
    """과거 유사 프로젝트 검색을 위한 다중 쿼리 5개 생성 노드"""
    
    parser = PydanticOutputParser(pydantic_object=QueryList)

    query_prompt = ChatPromptTemplate.from_messages([
        SystemMessagePromptTemplate.from_template(
            "당신은 디스코드 봇 외주 프로젝트의 견적을 산출하기 위해 과거 데이터를 검색하는 '검색 쿼리 엔지니어'입니다.\n"
            "고객의 요구사항(협상 내용 포함)을 분석하여, 과거의 유사한 프로젝트 명세서를 찾기 위한 5개의 다르고 독립적인 검색 쿼리를 생성하세요.\n\n"
            "[쿼리 생성 전략 (각 1개씩 생성)]\n"
            "1. 핵심 기능 중심: (예: '역할 지급 봇', '자동 공지 채널 포스팅', '크롤링')\n"
            "2. 비즈니스 로직 중심: (예: '결제 연동', '비용 비례 노출', '구독 모델')\n"
            "3. 기술 스택 및 API 중심: (예: 'DB 연동', '외부 API 호출', '웹훅')\n"
            "4. 목적 및 타깃 중심: (예: '서버 홍보', '이벤트 관리', '유저 관리')\n"
            "5. 포괄적 자연어 쿼리: 전체적인 맥락을 요약한 문장형 쿼리\n\n"
            "반드시 정확히 5개의 쿼리를 생성해야 하며, 검색 엔진(FAISS+BM25)에 최적화된 명사/키워드 위주의 문구로 작성하세요.\n\n"
            "{format_instructions}"
        ),
        HumanMessagePromptTemplate.from_template(
            "[현재 요구사항]\n{question}"
        )
    ])

    chain = query_prompt.partial(format_instructions=parser.get_format_instructions()) | low_gpt_model | parser

    result: QueryList = await chain.ainvoke({"question": state["input_message"]})
    
    logger.info(f"생성된 검색 쿼리: {result.queries}")

    return {
        "search_queries": result.queries,
        "estimation_retry_count": 0,
        "retrieved_projects": []
    }


async def workspace_node(state: WorkspaceState) -> dict:
    """독립된 워크스페이스: 검색 -> 재조립 -> 평가/요약 -> (필요시) 재검색"""
    
    input_message = state["input_message"]
    current_query = state["current_query"]
    
    parser = PydanticOutputParser(pydantic_object=WorkspaceEvaluation)
    
    eval_prompt = ChatPromptTemplate.from_messages([
        SystemMessagePromptTemplate.from_template(
            "당신은 과거 디스코드 봇 외주 프로젝트 문서를 분석하는 '프로젝트 평가/요약 전문가'입니다.\n"
            "검색된 [과거 프로젝트 명세서]가 고객의 [현재 요구사항]과 얼마나 유사한지 점수(0~100)를 매기고 요약하세요.\n\n"
            "[지시사항]\n"
            "1. 연관성(is_relevant): 주요 기능, 목적, 난이도 등이 비슷하여 견적(비용/시간) 산출에 도움이 된다면 70점 이상(True)을 부여하세요.\n"
            "2. 요약(summary): 과거 프로젝트의 '실제 제작 비용', '소요 기간', '기술 스택', '주요 기능'을 반드시 포함하여 요약하세요.\n"
            "3. 재검색(new_query): 70점 미만일 경우, 과거 데이터를 더 잘 찾을 수 있도록 구체적인 새로운 단일 키워드 쿼리를 제안하세요.\n\n"
            "{format_instructions}"
        ),
        HumanMessagePromptTemplate.from_template(
            "[현재 요구사항]\n{input_message}\n\n[과거 프로젝트 명세서]\n{past_project}"
        )
    ])
    eval_chain = eval_prompt.partial(format_instructions=parser.get_format_instructions()) | high_gpt_model | parser

    for attempt in range(2):
        logger.info(f"🔍 [Workspace] 검색 시도 {attempt + 1}/2 - 쿼리: {current_query}")
        
        search_results = faiss_manager.hybrid_search(
            query=current_query, 
            k=3, 
            filter_dict={"doc_type": "project"}
        )
        
        project_ids = list(set([doc.metadata.get("project_id") for doc in search_results if doc.metadata.get("project_id")]))
        
        if not project_ids:
            current_query = f"{current_query} 디스코드 봇 기능"
            continue
            
        top_project_id = project_ids[0]
        full_project_doc = faiss_manager.get_full_project_document(top_project_id)
        
        if not full_project_doc:
            continue
            
        result: WorkspaceEvaluation = await eval_chain.ainvoke({
            "input_message": input_message,
            "past_project": full_project_doc
        })
        
        logger.info(f"📊 [Workspace] 평가 점수: {result.score}점 (통과: {result.is_relevant})")
        
        if result.is_relevant:
            formatted_summary = f"[참고 프로젝트: {top_project_id}]\n{result.summary}"
            return {"retrieved_projects": [formatted_summary]}
            
        current_query = result.new_query or current_query

    return {"retrieved_projects": []}


async def estimation_node(state: MainState) -> dict:
    """과거 데이터를 바탕으로 비용과 시간을 산출하는 노드"""
    
    parser = PydanticOutputParser(pydantic_object=EstimationResult)
    past_projects_text = "\n\n".join(state["retrieved_projects"]) if state["retrieved_projects"] else "검색된 과거 유사 프로젝트 데이터가 없습니다. 일반적인 시장 단가와 개발자의 경험을 바탕으로 산출하세요."

    prompt = ChatPromptTemplate.from_messages([
        SystemMessagePromptTemplate.from_template(
            "당신은 디스코드 봇 개발 에이전시의 유능하고 유연한 '수석 견적 산출가 겸 비즈니스 파트너'입니다.\n"
            "고객의 [요구사항]과 [과거 유사 프로젝트 데이터]를 분석하여 합리적인 제작 비용(원화)과 소요 기간을 산출하세요.\n\n"
            "[지시사항]\n"
            "1. 과거 데이터가 있다면 이를 최우선 기준으로 삼아 비교 분석하여 견적을 내세요.\n"
            "2. 과거 데이터가 없다면, 요구사항의 난이도(DB 유무, 외부 API 등)를 스스로 평가하여 일반적인 프리랜서 단가로 산출하세요.\n"
            "3. 고객에게 전달할 친절하고 전문적인 톤으로, 왜 이런 견적이 나왔는지 논리적인 근거를 포함해 마크다운 포맷으로 작성하세요.\n"
            "4. [협상 및 톤앤매너 특별 지침] (매우 중요)\n"
            "   - 고객이 예산 삭감을 요청하거나 낮은 예산을 제시할 경우, 절대 방어적이거나 훈계하는 어조('현실적으로 부족합니다', '고객이 고집한다면' 등)를 사용하지 마세요.\n"
            "   - 'DIY 패키지'와 같이 저렴해 보이는 단어 사용을 엄격히 금지합니다.\n"
            "   - 고객의 예산을 존중하며 무조건 안 된다고 하지 말고, 해당 예산 내에서 맞출 수 있도록 기능 범위를 조정한 '핵심 기능 최적화(Lite) 플랜' 또는 'MVP(최소기능구현) 패키지'를 긍정적으로 제안하세요.\n"
            "   - 항상 고객의 비즈니스 성공을 돕는 유연하고 협조적인 파트너의 톤을 유지하세요.\n\n"
            "{format_instructions}"
        ),
        HumanMessagePromptTemplate.from_template(
            "[현재 요구사항]\n{input_message}\n\n[과거 유사 프로젝트]\n{past_projects}"
        )
    ])
    
    chain = prompt.partial(format_instructions=parser.get_format_instructions()) | high_gpt_model | parser
    result: EstimationResult = await chain.ainvoke({
        "input_message": state["input_message"],
        "past_projects": past_projects_text
    })

    current_retry = state.get("estimation_retry_count", 0)
    return {
        "estimation_draft": result.estimation_draft,
        "estimation_retry_count": current_retry + 1
    }

async def hallucination_check_node(state: MainState) -> dict:
    """견적 내용이 논리적인지, 과거 데이터를 무시하거나 없는 사실을 지어내지 않았는지 검사"""

    parser = PydanticOutputParser(pydantic_object=HallucinationEvaluation)
    past_projects_text = "\n\n".join(state["retrieved_projects"]) if state["retrieved_projects"] else "과거 데이터 없음"

    prompt = ChatPromptTemplate.from_messages([
        SystemMessagePromptTemplate.from_template(
            "당신은 견적서 품질 보증(QA) 담당자입니다. 산출된 [견적서]가 논리적인지 평가하여 0.0~1.0 사이의 점수를 부여하세요.\n"
            "- 0.8 이상: 매우 논리적이고, 과거 데이터(있을 경우)를 잘 반영함.\n"
            "- 0.8 미만: 근거 없는 터무니없는 가격, 없는 기능 지어냄, 과거 데이터를 무시함.\n"
            "{format_instructions}"
        ),
        HumanMessagePromptTemplate.from_template(
            "[견적서]\n{draft}\n\n[과거 데이터]\n{past_projects}"
        )
    ])
    
    chain = prompt.partial(format_instructions=parser.get_format_instructions()) | low_gpt_model | parser
    result: HallucinationEvaluation = await chain.ainvoke({
        "draft": state["estimation_draft"],
        "past_projects": past_projects_text
    })
    
    logger.info(f"[QA] 견적서 신뢰도: {result.score} ({result.reason})")
    return {"hallucination_score": result.score}


async def estimation_hitl_node(state: MainState) -> dict:
    """클라이언트에게 견적을 제시하고 피드백을 받는 대기 노드"""
    
    raw_feedback = state.get("human_feedback")
    
    if not raw_feedback:
        return {}
        
    feedback = str(raw_feedback).strip()
    
    if feedback.upper() == "STOP":
        return {"project_status": "STOP", "human_feedback": None}
        
    if feedback.upper() == "ACCEPT" or feedback == "수락":
        return {"project_status": "ACCEPT", "human_feedback": None}
        
    safe_feedback = feedback.replace("\n", " ").replace("\r", " ").replace('"', "'").replace("{", "(").replace("}", ")")
    
    updated_input = f"{state.get('input_message', '')}\n\n[고객의 견적 피드백/네고]: {safe_feedback}"
    
    return {
        "input_message": updated_input,
        "project_status": "CONTINUE",
        "human_feedback": None
    }


async def finalize_and_store_node(state: MainState) -> dict:
    """최종 요구사항 명세서를 작성하고 FAISS 벡터 DB에 적재하는 노드"""

    prompt = ChatPromptTemplate.from_messages([
        SystemMessagePromptTemplate.from_template(
            "당신은 개발 프로젝트 매니저입니다.\n"
            "고객의 최초 요구사항부터 각종 피드백, 그리고 최종 합의된 견적 및 기간을 모두 종합하여, "
            "개발자가 바로 보고 개발에 착수할 수 있는 완벽한 [최종 요구사항 명세서]를 마크다운 포맷으로 작성하세요.\n"
            "비용과 소요 기간도 명세서 하단에 반드시 명시하세요."
        ),
        HumanMessagePromptTemplate.from_template("[모든 대화 히스토리 및 합의 내용]\n{history}")
    ])
    
    chain = prompt | high_gpt_model | StrOutputParser()
    final_spec = await chain.ainvoke({"history": state["input_message"] + "\n\n[합의된 견적]: " + state["estimation_draft"]})
    
    new_project_id = f"PROJ_{uuid.uuid4().hex[:8].upper()}"
    
    with tempfile.NamedTemporaryFile(delete=False, mode="w", encoding="utf-8") as temp_file:
        temp_file.write(final_spec)
        temp_file_path = temp_file.name
        
    try:
        faiss_manager.add_project_document(file_path=temp_file_path, project_id=new_project_id)
        logger.info(f"[DB 저장 완료] 새로운 프로젝트가 FAISS에 적재되었습니다: {new_project_id}")
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

    return {"final_requirement_specs": final_spec}