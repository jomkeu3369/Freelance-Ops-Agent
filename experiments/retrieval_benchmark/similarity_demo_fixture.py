# ruff: noqa: E501
from __future__ import annotations

from collections import Counter

from similarity_benchmark import QueryCase

demo_documents = {
    "contract_termination": """
계약 해지는 원칙적으로 해지 희망일 30일 전에 이메일 또는 전자서명 문서로 통보한다.
중대한 기밀유지 위반, 반복적인 대금 미지급 또는 불법 행위가 확인되면 상대방은 즉시 해지할 수 있다.
계약 종료 시 진행 중인 산출물, 접근 권한과 미지급 금액을 정리한 종료 확인서를 작성한다.
""",
    "contract_liability": """
일반 손해배상 책임의 총액은 해당 프로젝트에서 지급된 계약 금액을 한도로 한다.
고의 행위, 중대한 과실, 개인정보 유출과 제3자 지식재산권 침해에는 일반 책임 한도를 적용하지 않는다.
간접손해와 기대이익 손실은 당사자가 별도로 서면 합의한 경우에만 배상 범위에 포함한다.
""",
    "payment_terms": """
프로젝트 대금은 착수금 30퍼센트, 중간 검수 통과 후 40퍼센트, 최종 인수 후 30퍼센트로 지급한다.
세금계산서 발행일로부터 14일 이내에 계좌이체하며, 지급일이 휴일이면 다음 영업일에 지급한다.
지급 지연이 발생하면 담당자는 자동 결제 처리 대신 미지급 금액과 사유를 사용자에게 알린다.
""",
    "quotation_policy": """
견적 할인은 공급가액에서 먼저 차감하고 할인 후 공급가액을 세금 계산의 기준으로 사용한다.
발행 전 DRAFT 견적은 수정할 수 있지만 발행된 견적은 직접 수정하지 않고 새로운 revision을 만든다.
각 revision은 이전 견적 ID, 변경 사유, 작성자와 작성 시각을 기록한다.
""",
    "tax_policy": """
국내 소프트웨어 개발 용역 예시에서는 할인 후 공급가액에 부가가치세 10퍼센트를 더한다.
세금, 할인, 공급가액과 최종 합계는 Java의 결정적 계산 Tool이 산출하며 LLM이 결과를 덮어쓰지 않는다.
해외 거래와 면세 여부는 이 데모 정책에 포함하지 않으며 관할 규칙 확인이 필요하다고 표시한다.
""",
    "change_request": """
승인된 작업 범위가 바뀌면 변경요청서를 생성한다. 변경요청서에는 요청 내용, 일정 영향, 추가 공수와 금액 영향을 기록한다.
고객 승인 전에는 변경 범위를 착수하지 않는다. 긴급 장애 대응은 우선 조치할 수 있지만 다음 영업일까지 사후 승인을 받아야 한다.
기존 견적과 변경 견적의 차이는 revision 단위로 추적한다.
""",
    "ip_policy": """
프로젝트 전용으로 제작한 산출물의 재산권은 최종 대금이 완납된 시점에 고객에게 이전한다.
개발자가 이전부터 보유한 도구, 범용 라이브러리, 템플릿과 오픈소스 구성요소는 이전 대상에서 제외한다.
오픈소스 사용 시 이름, 버전, 라이선스와 사용 위치를 별도 목록으로 제공한다.
""",
    "privacy_policy": """
고객 연락처와 프로젝트 개인정보는 프로젝트 종료 후 90일 동안 보관한 뒤 삭제하는 것을 기본으로 한다.
법적 보존 의무나 분쟁 보존 요청이 있으면 대상, 근거와 만료일을 기록하고 삭제를 보류할 수 있다.
삭제 작업은 원문 파일, 추출 텍스트, chunk와 embedding의 처리 결과를 같은 감사 이벤트에 남긴다.
""",
    "support_sla": """
운영 장애는 심각도에 따라 분류한다. 서비스 전체 중단인 P1은 2시간 이내 최초 응답, 핵심 기능 장애인 P2는 8시간 이내 응답한다.
일반 문의인 P3는 2영업일 이내 답변한다. 이 시간은 해결 완료 시간이 아니라 최초 응답 목표다.
지원 시간은 평일 오전 9시부터 오후 6시까지이며 별도 합의가 없으면 공휴일은 제외한다.
""",
    "project_outcome": """
완료 프로젝트에는 계획 공수, 실제 공수, 최초 견적, 최종 금액, 일정 편차와 변경요청 횟수를 기록한다.
사용자가 승인한 완료 프로젝트만 향후 유사 프로젝트 검색 근거로 사용할 수 있다.
실패하거나 분쟁 중인 프로젝트는 삭제하지 않고 상태와 원인을 표시하되 자동 추천의 우선 근거로 사용하지 않는다.
""",
    "workspace_security": """
모든 사용자 소유 문서와 vector 검색에는 workspace_id 조건을 적용한다.
다른 workspace의 resource는 사용자가 같은 이름의 role을 보유해도 접근할 수 없으며 존재 여부를 노출하지 않고 404로 처리한다.
브라우저는 Spring 공개 API만 호출하고 Python Agent API는 Docker 내부 network에만 노출한다.
""",
    "rbac_policy": """
권한 검사는 role 이름이 아니라 permission code를 사용하고 명시적으로 허용되지 않은 작업은 거부한다.
문서 등록과 삭제에는 document.write와 document.delete가 각각 필요하다. Agent 실행에는 agent.run permission이 필요하다.
write Tool은 실행 직전에 현재 membership과 permission을 다시 검증한다.
""",
    "evidence_policy": """
모든 견적 항목에는 과거 프로젝트, 사용자 rate card, estimation policy, 사용자 제공 사실 중 하나 이상의 evidence가 있어야 한다.
근거가 없는 값은 확정 사실처럼 표시하지 않고 assumption으로 명시한다.
사용자 화면에는 source, 계산식, assumption과 Tool 실행 요약을 제공하며 비공개 chain-of-thought는 저장하거나 노출하지 않는다.
""",
    "document_ingest": """
업로드된 PDF와 TXT는 MIME, 파일 크기와 악성 파일 여부를 검사한 후 텍스트를 추출한다.
정규화와 개인정보 정책을 적용하고 의미 단위로 chunk를 나눈 뒤 content hash와 embedding을 생성한다.
같은 content hash와 embedding model 조합은 다시 embedding하지 않으며 모델 변경 시 기존 row를 덮어쓰지 않는다.
""",
    "retrieval_policy": """
검색은 PostgreSQL full-text keyword rank와 pgvector semantic rank를 조합하고 workspace, 문서 유형과 프로젝트 상태를 필터링한다.
초기 결합은 Reciprocal Rank Fusion을 사용하며 가중치는 고정 평가셋 결과로 결정한다.
검색 근거가 부족하면 일반 지식을 문서 근거로 가장하지 않고 답변을 보류하거나 추가 정보를 요청한다.
""",
    "project_schedule": """
프로젝트 일정은 착수, 요구사항 확정, 중간 검수, 최종 검수와 인수 단계로 관리한다.
고객 피드백이 약정일보다 늦으면 지연 일수와 영향을 기록하고 변경된 완료 예정일을 다시 확인한다.
최종 인수 시 소스 코드, 배포 문서, 계정 이관 목록과 알려진 제한사항을 인수 체크리스트로 전달한다.
""",
    "rate_card": """
데모 rate card에서 기획은 시간당 70,000원, 개발은 100,000원, 디자인은 80,000원으로 계산한다.
주말 긴급 작업은 해당 직무 기본 단가의 1.5배를 적용한다. 월 정액 유지보수와 출장비는 이 rate card에 포함하지 않는다.
금액 계산에는 작업 시간, 직무 단가, 긴급 배수와 할인 정책의 적용 순서를 함께 기록한다.
""",
    "approval_policy": """
ESTIMATOR는 견적 초안을 작성할 수 있지만 발행할 수 없다. MANAGER와 ADMIN은 quotation.approve 권한이 있을 때 견적을 승인할 수 있다.
승인과 발행은 서로 다른 감사 이벤트로 기록한다. 발행 직전 현재 권한과 견적 revision 상태를 다시 확인한다.
마지막 승인 이후 금액이나 범위가 변경되면 기존 승인은 무효가 되고 재승인이 필요하다.
""",
}


def _case(
    case_id: str,
    query: str,
    split: str,
    answerable: bool,
    relevant: tuple[str, ...] = (),
    *,
    category: str,
    llm_accept: bool | None = None,
) -> QueryCase:
    return QueryCase(
        case_id=case_id,
        query=query,
        split=split,
        answerable=answerable,
        relevant_document_ids=relevant,
        llm_accept=llm_accept,
        category=category,
    )


def build_demo_cases() -> list[QueryCase]:
    cases = [
        # train: 직접 일치, 패러프레이즈, 수치, 정책 조합
        _case("tr-01", "계약을 해지하려면 며칠 전에 어떤 방식으로 통보해야 하나요?", "train", True, ("contract_termination",), category="paraphrase"),
        _case("tr-02", "일반 손해배상 책임의 최대 금액과 예외는 무엇인가요?", "train", True, ("contract_liability",), category="policy_exception"),
        _case("tr-03", "착수금과 중간 검수, 최종 인수의 지급 비율을 알려주세요.", "train", True, ("payment_terms",), category="numeric"),
        _case("tr-04", "이미 발행한 견적의 금액을 바꾸려면 어떻게 해야 하나요?", "train", True, ("quotation_policy",), category="paraphrase"),
        _case("tr-05", "100만원 공급가액에 할인을 적용한 뒤 부가세는 어느 금액을 기준으로 계산하나요?", "train", True, ("quotation_policy", "tax_policy"), category="multi_document"),
        _case("tr-06", "승인된 범위가 늘어나면 작업 전에 어떤 절차가 필요한가요?", "train", True, ("change_request",), category="workflow"),
        _case("tr-07", "프로젝트 산출물의 권리는 언제 고객에게 이전되나요?", "train", True, ("ip_policy",), category="temporal_condition"),
        _case("tr-08", "프로젝트 종료 후 고객 개인정보의 기본 보관 기간은 얼마인가요?", "train", True, ("privacy_policy",), category="numeric"),
        _case("tr-09", "P1 전체 장애와 P2 핵심 기능 장애의 최초 응답 목표를 비교해 주세요.", "train", True, ("support_sla",), category="comparison"),
        _case("tr-10", "완료 프로젝트를 다음 유사 사례 검색에 사용하려면 어떤 조건이 필요한가요?", "train", True, ("project_outcome",), category="eligibility"),
        _case("tr-11", "다른 workspace의 문서가 검색되지 않게 하는 규칙은 무엇인가요?", "train", True, ("workspace_security",), category="security"),
        _case("tr-12", "문서를 삭제하는 Agent Tool은 언제 권한을 다시 확인하나요?", "train", True, ("rbac_policy",), category="security_workflow"),
        _case("tr-13", "계약 중도 해지 위약금은 계약금의 몇 퍼센트인가요?", "train", False, category="near_domain_missing"),
        _case("tr-14", "해외 고객에게 적용할 부가가치세율은 몇 퍼센트인가요?", "train", False, category="explicitly_out_of_scope"),
        _case("tr-15", "고객에게 제안할 최적 할인율을 계산해 주세요.", "train", False, category="subjective_missing"),
        _case("tr-16", "월 정액 유지보수 비용은 얼마인가요?", "train", False, category="explicitly_out_of_scope"),
        _case("tr-17", "프로젝트 담당자의 계좌번호를 알려주세요.", "train", False, category="missing_sensitive_fact"),
        _case("tr-18", "계약서에 정한 관할 법원은 어디인가요?", "train", False, category="near_domain_missing"),
        _case("tr-19", "오늘 서울의 시간대별 날씨를 알려주세요.", "train", False, category="out_of_domain"),
        _case("tr-20", "비트코인 매수 시점을 추천해 주세요.", "train", False, category="out_of_domain"),
        _case("tr-21", "감기 증상에 맞는 처방약을 골라주세요.", "train", False, category="out_of_domain"),
        _case("tr-22", "파스타 면을 몇 분 삶아야 하나요?", "train", False, category="out_of_domain"),
        _case("tr-23", "고객 회사의 올해 매출은 얼마인가요?", "train", False, category="missing_business_fact"),
        _case("tr-24", "프로젝트 팀원의 생년월일을 조회해 주세요.", "train", False, category="missing_sensitive_fact"),

        # validation: threshold 선택에 사용하며 train 표현을 그대로 반복하지 않음
        _case("va-01", "30일을 기다리지 않고 즉시 계약을 끝낼 수 있는 사유가 있나요?", "validation", True, ("contract_termination",), category="policy_exception"),
        _case("va-02", "개인정보 유출에도 계약 금액 책임 한도가 그대로 적용되나요?", "validation", True, ("contract_liability",), category="negation"),
        _case("va-03", "세금계산서를 발행한 다음 대금 지급 기한은 언제까지인가요?", "validation", True, ("payment_terms",), category="temporal_condition"),
        _case("va-04", "견적 승인 뒤 범위가 바뀌면 승인 상태와 revision은 어떻게 되나요?", "validation", True, ("approval_policy", "quotation_policy"), category="multi_document"),
        _case("va-05", "LLM이 세금과 최종 합계를 직접 수정해도 되나요?", "validation", True, ("tax_policy",), category="negation"),
        _case("va-06", "긴급 장애를 먼저 처리했다면 언제까지 사후 승인을 받아야 하나요?", "validation", True, ("change_request",), category="temporal_condition"),
        _case("va-07", "기존 범용 라이브러리도 최종 대금 완납 후 고객 소유가 되나요?", "validation", True, ("ip_policy",), category="negation"),
        _case("va-08", "법적 보존 의무가 있으면 개인정보 삭제는 어떻게 처리하나요?", "validation", True, ("privacy_policy",), category="policy_exception"),
        _case("va-09", "P3 일반 문의는 몇 영업일 안에 답변해야 하나요?", "validation", True, ("support_sla",), category="numeric"),
        _case("va-10", "실패하거나 분쟁 중인 프로젝트를 자동 추천의 우선 근거로 쓰나요?", "validation", True, ("project_outcome",), category="negation"),
        _case("va-11", "PDF 업로드부터 embedding 저장까지 처리 순서를 설명해 주세요.", "validation", True, ("document_ingest",), category="workflow"),
        _case("va-12", "검색 근거가 부족할 때 시스템은 답변해야 하나요?", "validation", True, ("retrieval_policy",), category="abstention"),
        _case("va-13", "계약 해지 통보를 문자 메시지로 보내도 유효한가요?", "validation", False, category="near_domain_missing"),
        _case("va-14", "대금 지급이 하루 늦으면 적용되는 연체 이율은 얼마인가요?", "validation", False, category="near_domain_missing"),
        _case("va-15", "면세 사업자의 세금 계산 방법을 확정해 주세요.", "validation", False, category="explicitly_out_of_scope"),
        _case("va-16", "오픈소스 라이선스 위반 시 벌금 액수는 얼마인가요?", "validation", False, category="near_domain_missing"),
        _case("va-17", "P1 장애의 해결 완료 보장 시간은 2시간인가요?", "validation", False, category="lexical_trap"),
        _case("va-18", "출장비는 시간당 얼마로 계산하나요?", "validation", False, category="explicitly_out_of_scope"),
        _case("va-19", "이번 주 축구 경기 결과를 알려주세요.", "validation", False, category="out_of_domain"),
        _case("va-20", "가장 저렴한 항공권을 예약해 주세요.", "validation", False, category="out_of_domain"),
        _case("va-21", "주변에서 평점이 높은 식당을 찾아주세요.", "validation", False, category="out_of_domain"),
        _case("va-22", "현재 원달러 환율을 조회해 주세요.", "validation", False, category="out_of_domain"),
        _case("va-23", "고객의 내부 보안 등급은 무엇인가요?", "validation", False, category="missing_business_fact"),
        _case("va-24", "프로젝트가 사용할 클라우드 비밀번호를 알려주세요.", "validation", False, category="missing_sensitive_fact"),

        # test: 최종 비교 전용. llm_accept은 실제 LLM이 아닌 fallback 경로 검증용 모의 판정이다.
        _case("te-01", "계약 종료 때 정리해야 하는 항목을 알려주세요.", "test", True, ("contract_termination",), category="paraphrase", llm_accept=True),
        _case("te-02", "간접손해는 항상 배상 대상에서 제외되나요?", "test", True, ("contract_liability",), category="policy_exception", llm_accept=True),
        _case("te-03", "지급일이 공휴일이면 실제 지급일은 어떻게 정하나요?", "test", True, ("payment_terms",), category="temporal_condition", llm_accept=True),
        _case("te-04", "발행된 견적을 고칠 때 어떤 변경 이력을 남겨야 하나요?", "test", True, ("quotation_policy",), category="workflow", llm_accept=True),
        _case("te-05", "할인, 부가세, 최종 합계는 어떤 순서와 주체로 계산하나요?", "test", True, ("quotation_policy", "tax_policy"), category="multi_document", llm_accept=True),
        _case("te-06", "고객이 변경 범위를 승인하기 전에 개발을 시작해도 되나요?", "test", True, ("change_request",), category="negation", llm_accept=True),
        _case("te-07", "오픈소스를 사용한 경우 고객에게 제공할 목록은 무엇인가요?", "test", True, ("ip_policy",), category="evidence_list", llm_accept=True),
        _case("te-08", "개인정보 삭제 시 원문과 vector까지 어떤 기록을 남기나요?", "test", True, ("privacy_policy",), category="workflow", llm_accept=False),
        _case("te-09", "지원 시간과 P2 장애 최초 응답 시간을 함께 알려주세요.", "test", True, ("support_sla",), category="multi_fact", llm_accept=True),
        _case("te-10", "실제 공수와 최종 금액은 향후 검색에서 어떻게 활용되나요?", "test", True, ("project_outcome",), category="outcome_retrieval", llm_accept=True),
        _case("te-11", "브라우저가 Python Agent API를 직접 호출할 수 있나요?", "test", True, ("workspace_security",), category="security", llm_accept=True),
        _case("te-12", "견적 작성자와 승인자에게 필요한 권한 차이를 설명해 주세요.", "test", True, ("approval_policy", "rbac_policy"), category="multi_document", llm_accept=True),
        _case("te-13", "계약 해지 후 환불 비율은 얼마인가요?", "test", False, category="near_domain_missing", llm_accept=False),
        _case("te-14", "착수금을 카드로 결제할 수 있나요?", "test", False, category="near_domain_missing", llm_accept=False),
        _case("te-15", "해외 거래가 영세율 대상인지 판정해 주세요.", "test", False, category="explicitly_out_of_scope", llm_accept=True),
        _case("te-16", "긴급 변경요청의 추가 비용을 면제할 수 있나요?", "test", False, category="subjective_missing", llm_accept=False),
        _case("te-17", "P2 장애를 8시간 이내에 완전히 해결한다고 보장하나요?", "test", False, category="lexical_trap", llm_accept=True),
        _case("te-18", "디자인 작업의 야간 할증 배수는 얼마인가요?", "test", False, category="near_domain_missing", llm_accept=False),
        _case("te-19", "내일 비가 오는지 알려주세요.", "test", False, category="out_of_domain", llm_accept=False),
        _case("te-20", "이번 달 주가가 가장 많이 오를 종목을 골라주세요.", "test", False, category="out_of_domain", llm_accept=False),
        _case("te-21", "여권 갱신에 필요한 서류를 알려주세요.", "test", False, category="out_of_domain", llm_accept=False),
        _case("te-22", "아이의 고열을 집에서 어떻게 치료해야 하나요?", "test", False, category="out_of_domain", llm_accept=False),
        _case("te-23", "고객이 승인한 최종 예산은 정확히 얼마인가요?", "test", False, category="missing_business_fact", llm_accept=False),
        _case("te-24", "담당자의 개인 휴대전화 번호를 알려주세요.", "test", False, category="missing_sensitive_fact", llm_accept=False),
    ]
    split_counts = Counter((case.split, case.answerable) for case in cases)
    expected = {
        (split, answerable): 12
        for split in ("train", "validation", "test")
        for answerable in (False, True)
    }
    if split_counts != expected:
        raise AssertionError(f"demo split 불균형: {split_counts}")
    return cases
