from langchain.chat_models import init_chat_model

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from src.logs.log import get_logger

logger = get_logger()

low_gpt_model = init_chat_model("openai:gpt-5-mini", temperature=0)

async def generate_styled_text(customer_message: str, original_text: str, tone: str) -> str:
    """
    LangChain을 사용하여 텍스트의 톤앤매너를 변환하는 함수
    """

    system_prompt = (
        "당신은 전문 카피라이터이자 편집자입니다. "
        "당신의 임무는 사용자의 원문을 요청된 어조와 스타일인 '{tone}'으로 재작성하는 것입니다. "
        "원문의 핵심 메시지와 의미는 유지하되, 대상 어조에 맞게 문체, 어휘, 문장 구조를 완전히 변경하십시오. "
        "거래처에게 전달할 '{tone}' 톤앤매너의 메시지를 작성한다고 상상하며 작업하십시오. "
        "[중요 조건] "
        "1. 당신은 혼자 일하는 '1인 개인 프리랜서'입니다. 사내 부서, 팀, 동료 등의 개념이 전혀 없습니다. "
        "2. 거절 시 '담당 부서로 연결해주겠다'거나 '담당자를 안내하겠다'는 식의 주체적인 연결 표현을 절대 사용하지 마십시오. "
        "3. 만약 '나의 날것의 답변'에 대안(예: AWS 고객센터 문의 등)이 포함되어 있다면, 고객이 직접 해당 기관에 문의하도록 정중하게 안내하십시오. "
        "4. 대안이 명시되어 있지 않다면, '해당 업무는 계약(작업) 범위 밖이므로 직접 조치가 어렵다'고 양해를 구하십시오. "
        "기계적인 자동응답기 같은 표현을 피하고, 비즈니스 파트너로서 예의를 갖추십시오. "
        "항상 원문과 동일한 언어로 응답하십시오. "
        "추가 설명이나 마크다운 서식 없이 재작성된 텍스트를 띄어쓰기를 유지한 채 출력하십시오."
    )

    user_prompt = (
        "[고객의 메시지]\n{customer_message}\n\n"
        "[나의 날것의 답변]\n{original_text}"
    )

    try:
        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("user", user_prompt)
        ])

        chain = prompt | low_gpt_model | StrOutputParser()

        result = await chain.ainvoke({
            "tone": tone, 
            "customer_message": customer_message if customer_message else "없음",
            "original_text": original_text
        })

        return result.strip()
        
    except Exception as e:
        logger.error(f"톤앤매너 변환 실패: {e}")
        raise e