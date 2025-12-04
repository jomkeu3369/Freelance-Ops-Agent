# Freelance-Ops-Agent

![Python](https://img.shields.io/badge/Python-3.12-blue?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)
![LangChain](https://img.shields.io/badge/AI-LangChain%20%26%20LangGraph-1C3C3C?logo=chainlink&logoColor=white)
![Docker](https://img.shields.io/badge/Deploy-Docker-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

> **"더 이상 감으로 견적 내지 마세요."**
>
> **Freelance-Ops-Agent**는 과거 프리랜서 경험과 Human-in-the-loop 피드백을 바탕으로 **구현 가능성, 적정 견적, 제작 기간**을 함께 산출하는 개인화된 견적 파트너입니다.

---

## 📖 Introduction

프리랜서 개발자로 일하면서 가장 골치 아픈 순간은 코딩할 때가 아니었습니다.
바로 **"이거 얼마에, 며칠 안에 가능하세요?"** 라는 질문을 받았을 때입니다. 

*"너무 비싸게 부르면 도망갈 것 같고, 싸게 부르면 내 손해인데..."*

이 고민을 끝내기 위해 **Freelance-Ops-Agent**를 만들었습니다. 이 프로젝트는 클라이언트가 던져준 모호한 요구사항 텍스트를 넣으면, AI가 과거 프로젝트 데이터를 RAG로 검색하고, LangGraph 기반 워크플로우와 가중치 프로필을 이용해 **가격·기간·리스크·질문사항**을 동시에 검토해 줍니다.

이 에이전트는 사용자의 피드백으로 **본인의 견적 스타일을 학습**합니다.  
견적을 수정할 때마다 risk_buffer, hourly_rate 등의 파라미터가 자동 보정되어, 사용할수록 **내 감각에 맞는 개인화된 견적 에이전트**로 진화합니다.

## ✨ Key Features

### 1. 📄 Smart Spec Analysis (명세서 자동 분석)

- `md`, `txt` 등 클라이언트가 준 정리되지 않은 요구사항을 LLM으로 파싱해 **기능 단위 JSON 스펙**으로 구조화합니다.
- 요구사항이 모호하면 클라이언트에게 되물어야 할 **질문 리스트**를 생성해, 사전 커뮤니케이션 비용을 줄여 줍니다.

### 2. 💰 Data-Driven Pricing (데이터 기반 견적)

- **RAG Engine**: "이 기능, 예전에 해봤나?" 제 과거 프로젝트 DB(100+건)를 뒤져서 가장 비슷한 사례를 찾아냅니다.
- **Dual Pricing**: 현재 시장 평균 단가와 실제 작업 난이도를 고려한 '권장 견적'을 동시에 제안합니다.
- **Output 예시**: "시장가는 50만원 선이지만, DB 이중화 작업이 포함되어 있어 80만원이 적정합니다."

### 3. ⏱️ Duration Estimation (제작 기간 산출)

- 각 기능에 대해 **complexity_points(Story Point)** 를 계산하고, 이를 기반으로 한 **LLM 추론 기간**을 산출합니다.
- 동시에 RAG로 과거 유사 프로젝트들의 **실제 소요 기간 평균**을 가져와, 두 값을 가중 평균하여 최종 기간을 계산합니다.

| 요소 | 설명 |
|------|------|
| LLM 추론 기간 | 스펙 난이도 기반 이론상 작업 일수 추정 |
| RAG 기간 | 유사 프로젝트들의 실제 평균 기간 |
| 최종 기간 | 두 값을 비율로 혼합한 하이브리드 기간 추정 |

***

## 🧠 RLHF-Lite Personalization

### 4. 🎛️ User Preference Profile (가중치 프로필)

- 에이전트는 `user_profile.json`에 저장된 **선호 가중치**를 참조해 견적을 냅니다.  
- 예시 필드:  
  - `market_price_weight`: 시장가 반영 비율  
  - `my_history_weight`: 내 과거 데이터(내 스타일) 비중  
  - `risk_buffer`: 리스크 여유분(기본 청구 배수)  
  - `hourly_rate`: 기준 시급  

이 구조는 전통적인 RLHF처럼 거대한 파이프라인을 돌리지 않고, **프롬프트/파라미터 레벨의 Preference Tuning**으로 빠르게 정렬하는 실용적인 방식입니다.

### 5. 🔁 Human-in-the-loop Feedback Loop

- LangGraph의 **interrupt / Human-in-the-loop 패턴**을 이용해, 견적 결과를 사용자에게 먼저 보여주고 **수정·승인·거절**을 받습니다.
- 사용자가 “이건 최소 1.4배는 더 받아야 한다”처럼 수정하면, 에이전트는 `risk_buffer`·`hourly_rate` 등을 조금씩 조정해 다음 견적에 반영합니다.
- 최종 확정된 견적서는 다시 Vector DB에 저장되어, 이후 RAG 검색 시 **정답 데이터** 로 활용됩니다.

***

## 🏗️ System Architecture

사용자가 명세서를 업로드하면, **Spec Parser → RAG Retriever → Estimator → Human Review** 순으로 흐르는 LangGraph 기반 파이프라인이 실행됩니다.

```mermaid
graph TD
    User[User / Client Input] -->|Upload Spec.md| SpecParser(LLM Spec Parser)
    SpecParser -->|ProjectEstimate JSON| Router{Agent Router}

    Router -->|Search History| RAG[(Vector DB / FAISS)]
    Router -->|Load Profile| Profile[user_profile.json]

    RAG --> Estimator[Estimator<br/>(Price & Duration)]
    Profile --> Estimator

    Estimator --> HumanReview{Human Review<br/>(LangGraph HIL)}
    HumanReview -->|Accept| Store[Store Final Estimate<br/>(Vector DB)]
    HumanReview -->|Edit| UpdateProfile[Update user_profile.json]

    Store --> Dashboard[Admin Dashboard / XP System]
    UpdateProfile --> Store
```

- **SpecParser**: 자연어 요구사항을 `price`, `duration_days`, `complexity_points`가 포함된 스키마로 변환합니다.
- **Estimator**: RAG에서 가져온 과거 Cost/Duration과 `user_profile.json`의 가중치를 이용해 가격·기간을 계산합니다.
- **HumanReview**: LangGraph interrupt를 사용해 사람이 결과를 수정하고, 수정 비율에 따라 프로필 파라미터를 업데이트합니다.

***

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| **Language** | Python 3.12 |
| **Backend** | FastAPI, Pydantic V2 |
| **AI / LLM** | LangChain, LangGraph, OpenAI (예: GPT 계열) |
| **Vector DB** | FAISS (Local), ChromaDB |
| **Deployment** | AWS EC2, Docker Compose |
| **Tools** | Git, Poetry |

***

## 🚀 Getting Started

설치·실행 방법은 기존 README 구조를 유지하면서, 아래와 같이 보완하면 됩니다.

1. **Clone Repository**
2. **환경 변수 설정**: OpenAI API Key 등
3. **Docker 실행 또는 로컬 실행**
4. `data/raw_specs`, `data/vector_store`, `user_profile.json` 초기화

***

## 📂 Project Structure

```bash
Freelance-Ops-Agent/
├── data/
│   ├── raw_specs/        # 요구사항 명세서 원본 (.md, .txt)
│   └── vector_store/     # FAISS / Chroma Vector Index
├── src/
│   ├── agent/            # LangGraph Nodes & Edges (SpecParser, Estimator, HumanReview 등)
│   ├── backend/          # FastAPI Server
│   ├── core/             # RAG & LLM Logic, Pricing/Duration Formula
│   └── utils/            # Parsers & Helpers
├── user_profile.json     # User Preference Profile (RLHF-Lite 가중치)
├── tests/                # Unit Tests
├── docker-compose.yml
└── README.md
```

***

## 📜 License

This project is licensed under the [MIT License](LICENSE).