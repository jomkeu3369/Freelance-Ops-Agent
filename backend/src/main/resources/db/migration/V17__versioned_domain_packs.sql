CREATE TABLE app.domain_pack (
    id UUID PRIMARY KEY,
    code VARCHAR(64) NOT NULL,
    version VARCHAR(100) NOT NULL,
    jurisdiction_code VARCHAR(32) NOT NULL,
    profession_code VARCHAR(64) NOT NULL,
    scope VARCHAR(10000) NOT NULL,
    required_fields JSONB NOT NULL CHECK (jsonb_typeof(required_fields) = 'array'),
    question_templates JSONB NOT NULL CHECK (jsonb_typeof(question_templates) = 'array'),
    source_references JSONB NOT NULL CHECK (jsonb_typeof(source_references) = 'array'),
    effective_from DATE NOT NULL,
    effective_until DATE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_domain_pack_version UNIQUE (code, jurisdiction_code, version),
    CONSTRAINT ck_domain_pack_effective_range CHECK (
        effective_until IS NULL OR effective_until >= effective_from
    )
);

CREATE INDEX ix_domain_pack_active_lookup
    ON app.domain_pack(code, jurisdiction_code, active, effective_from DESC);

INSERT INTO app.domain_pack (
    id, code, version, jurisdiction_code, profession_code, scope,
    required_fields, question_templates, source_references,
    effective_from, active, created_at
) VALUES (
    '10000000-0000-0000-0000-000000000001',
    'software-development',
    'kr-2026.08.1',
    'KR',
    'SOFTWARE_DEVELOPER',
    '대한민국 소프트웨어 개발 프리랜서의 요구사항·범위·납품·검수·유지보수 조건을 구조화한다. 법률 판단을 대신하지 않는다.',
    '["프로젝트 목표","사용자와 이해관계자","기능 요구사항","비기능 요구사항","기술 환경과 연동","납품물과 소스코드","일정과 마일스톤","예산과 결제 조건","검수 기준","하자보수와 유지보수","지식재산권과 라이선스","개인정보와 보안"]'::jsonb,
    '["핵심 사용자와 반드시 해결해야 하는 문제는 무엇인가요?","필수 기능과 후순위 기능을 구분해 주세요.","지원해야 하는 트래픽·응답시간·가용성 목표가 있나요?","기존 시스템·외부 API·결제·인증 연동 범위는 어디까지인가요?","디자인·콘텐츠·데이터·계정 중 고객이 제공하는 항목은 무엇인가요?","소스코드·배포 설정·운영 문서 중 최종 납품물을 정해 주세요.","마일스톤별 일정과 고객 검토 기한은 언제인가요?","검수 통과를 판단할 구체적인 acceptance criteria는 무엇인가요?","요구사항 변경 시 일정·금액 조정 절차는 어떻게 할까요?","오픈소스·폰트·이미지·외부 서비스 라이선스 책임을 어떻게 나눌까요?","개인정보 또는 민감정보를 처리한다면 보관·삭제·접근 통제 요구는 무엇인가요?","무상 하자보수 기간과 이후 유지보수 방식은 무엇인가요?"]'::jsonb,
    '[{"title":"찾기쉬운 생활법령정보 - 용역계약","url":"https://www.easylaw.go.kr/"},{"title":"개인정보보호위원회","url":"https://www.pipc.go.kr/"},{"title":"공정거래위원회","url":"https://www.ftc.go.kr/"}]'::jsonb,
    DATE '2026-08-14',
    TRUE,
    TIMESTAMPTZ '2026-08-14T00:00:00Z'
);
