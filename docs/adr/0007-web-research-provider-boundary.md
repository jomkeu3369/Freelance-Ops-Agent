# ADR-0007: 웹 자료 탐색·수집 Provider 경계

- 상태: Accepted
- 결정일: 2026-07-24

## Context

다양한 프리랜서 직군과 거래 국가를 지원하려면 최신 법률·정책·표준계약·거래 관행을 신뢰 가능한 출처에서 확보해야 한다. Tavily 하나에 탐색과 수집을 모두 결합하거나 Agent가 임의의 사이트를 자유롭게 크롤링하면 provider 종속, 반복 비용, 출처 품질 저하와 보안 문제가 발생한다. Crawl4AI는 알려진 동적 사이트와 구조화 추출에 유용하지만 Chromium 운영 비용과 사이트 변경 대응이 필요하다.

## Decision

- Python Agent runtime에 provider-neutral `WebResearchProvider` 경계를 둔다.
- capability는 `search`, `map`, `fetch`, `crawl`, `extract`로 구분하고 Agent graph가 특정 SDK 객체를 contract로 사용하지 않는다.
- Tavily는 새로운 출처 발견, 최신 검색과 선택적 Map·Extract·Crawl에 사용한다.
- Crawl4AI는 허용된 출처의 동적 페이지, 다중 페이지 수집과 CSS/XPath 기반 구조화 추출에 사용한다.
- 알려진 정적 URL은 직접 HTTP fetch를 우선하고, PDF는 전용 문서 추출기를 사용한다.
- provider 선택은 가능한 한 source type, URL 상태와 수집 정책에 따른 결정적 routing으로 수행한다.
- 법률·정책 수집은 jurisdiction과 domain별 allowlist, robots.txt·이용약관, rate limit과 개인정보 정책을 적용한다.
- 외부 문서의 지시를 Agent 명령으로 취급하지 않으며 수집 content는 untrusted input으로 격리한다.
- 같은 문서를 사용자마다 다시 크롤링하지 않는다. 원문 snapshot, content hash, parser version과 검색용 파생물을 저장하여 재사용한다.
- 문서에는 URL, 발행자, 관할권, 문서 유형, 발행·시행·수집 시점, authority level과 parser version을 기록한다.
- 첫 단계에서는 Crawl4AI를 별도 microservice로 분리하지 않고 제한된 동시성의 비동기 worker로 실행한다. 장애 격리나 독립 확장 필요성이 측정되면 새 ADR로 분리한다.
- Tavily와 Crawl4AI는 고정 도입이 아니라 동일 corpus의 수집 성공률, 정확도, latency와 비용 benchmark를 통과해야 운영 route가 된다.

## Consequences

장점:

- 검색 provider를 교체하거나 용도별로 조합할 수 있다.
- 공식 자료를 한 번 수집하고 여러 사용자 검색에서 재사용해 비용을 줄일 수 있다.
- 출처의 기준일과 원문 snapshot까지 추적할 수 있다.

비용:

- crawler 보안, 동시성, timeout, parser 회귀와 source freshness 관리가 필요하다.
- Chromium 기반 Crawl4AI는 Agent container의 CPU와 memory를 추가로 사용한다.
- 웹 문서의 저작권, 이용약관과 개인정보 취급을 source별로 검토해야 한다.

## Rejected alternatives

- Tavily만 Agent Tool로 직접 호출: 빠르지만 provider 종속과 반복 수집 비용이 커진다.
- Crawl4AI로 모든 웹 탐색 수행: 검색 discovery 품질과 browser 운영 부담 때문에 거부한다.
- 매 사용자 요청마다 실시간 재크롤링: 비용, latency와 재현성이 나빠지므로 거부한다.
- 임의 도메인 무제한 크롤링: 보안과 준수 위험 때문에 거부한다.

## Implementation status — 2026-08-14

Provider-neutral contract, Tavily discovery, allowlisted direct HTML·text·PDF fetch와 제한형 Crawl4AI adapter를 구현했다. 운영 Research 부서는 명시된 domain allowlist, `document.read`, Tool·search-credit budget이 모두 있을 때만 검색한다. 수집 문서는 URL·content hash·parser·관할권을 보존하고 prompt-injection signal이 발견된 내용은 model context에 전달하지 않는다. Crawl4AI runtime 승격과 실제 공식 source corpus benchmark는 아직 남아 있다.
