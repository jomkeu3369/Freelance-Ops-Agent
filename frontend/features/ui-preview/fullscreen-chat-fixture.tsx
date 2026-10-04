"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { LocaleProvider, useT, useUiLocale } from "../../app/lib/ui-language";
import type { Project } from "../../app/lib/api";
import { parseChatPolicyIntent } from "../../app/lib/chat-policy-intent.mjs";
import { chatState } from "../../app/lib/chat-presentation.mjs";
import { AgentChatSurface, type AgentChatSurfaceProps } from "../workspace/project/analysis/agent-chat";
import { ChatModelMenu } from "../workspace/project/analysis/chat-model-menu";
import { ChatModelControls } from "../workspace/project/analysis/chat-model-controls";
import { creditDecision, type WeeklyCreditUsage } from "../../app/lib/credit-policy";
import { CreditCostNote } from "../workspace/usage/credit-cost-note";
import { ProjectStepNavigation } from "../workspace/project/project-workbench";
import { WorkspaceChrome } from "../workspace/workspace-chrome";
import { WorkspacePanel } from "../workspace/shared/workspace-panel";
import "../../app/workspace/figma-workspace.css";
import "../../app/workspace/quick-intake.css";
import "../workspace/project/analysis/agent-chat.css";
import "../workspace/professional-workspace.css";
import "../workspace/fullscreen-chat.css";

const projects: Project[] = [
  { id: "sample-studio", workspaceId: "ui-story", clientId: null, title: "브랜드 스튜디오 웹사이트", requirementText: "Synthetic layout example", currency: "KRW", deadline: null, budgetMin: null, budgetMax: null, status: "LEAD", updatedAt: "2026-10-04T00:00:00Z" },
  { id: "sample-booking", workspaceId: "ui-story", clientId: null, title: "예약 서비스 리뉴얼", requirementText: "Synthetic layout example", currency: "KRW", deadline: null, budgetMin: null, budgetMax: null, status: "NEGOTIATING", updatedAt: "2026-10-03T00:00:00Z" },
  { id: "sample-portfolio", workspaceId: "ui-story", clientId: null, title: "포트폴리오 디자인", requirementText: "Synthetic layout example", currency: "KRW", deadline: null, budgetMin: null, budgetMax: null, status: "IN_PROGRESS", updatedAt: "2026-10-02T00:00:00Z" },
];
// Explicit synthetic pricing for this isolated story; never a fallback in the app.
const sampleUsage: WeeklyCreditUsage = {
  unit: "CREDITS", periodType: "WEEKLY", limit: 100, used: 0, reserved: 0, remaining: 100,
  resetAt: "2026-10-11T15:00:00Z", period: "2026-10-05", timezone: "Asia/Seoul", epoch: 1,
  canManage: false, pricingUpdatedAt: "2026-10-04T12:00:00.123456Z",
  modelRates: [{ provider: "OPENAI", model: "gpt-5.6-luna", credits: 10, enabled: true }, { provider: "OPENAI", model: "gpt-5.6-terra", credits: 100, enabled: true }],
};
const permissions = new Set(["project.read", "project.write", "client.read", "document.read"]);
const noop = () => {};
const asyncNoop = async () => {};
const subscribeHydration = () => noop;
function subscribeCompact(notify: () => void) {
  const media = window.matchMedia("(max-width: 820px)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

export function FullscreenChatFixture() {
  return <LocaleProvider><FixtureSurface /></LocaleProvider>;
}

function FixtureSurface() {
  const t = useT();
  const locale = useUiLocale();
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selected, setSelected] = useState(projects[0].id);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(sampleUsage.modelRates[0].model);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<string | null>(null);
  const compact = useSyncExternalStore(subscribeCompact, () => window.matchMedia("(max-width: 820px)").matches, () => false);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const followsLatest = useRef(true);
  const composing = useRef(false);
  const label = locale === "en" ? "UI preview · sample data · no API connection" : "화면 미리보기 · 샘플 데이터 · API 연결 없음";
  const explanation = locale === "en" ? "This screen renders the actual workspace components with fixed sample data. It does not sign in, call an AI, or save changes." : "실제 업무 화면 컴포넌트를 고정된 샘플 데이터로 보여줍니다. 로그인하거나 AI를 호출하거나 변경사항을 저장하지 않습니다.";
  const showPreviewNotice = () => setPanel(locale === "en" ? "UI preview" : "화면 미리보기");
  const decision = creditDecision(sampleUsage, "OPENAI", model);
  const modelControls = <ChatModelControls modelRates={sampleUsage.modelRates} connections={[]} credentialId="" provider="OPENAI" model={model}
    busy={false} connectionError={false} onCredentialChange={noop} onProviderChange={() => setModel(sampleUsage.modelRates[0].model)} onModelChange={setModel} />;
  const surface: AgentChatSurfaceProps = {
    t, presentation: chatState(null), headerTools: <span data-ui-fixture-label style={{ color: "var(--muted)", fontSize: ".6875rem", lineHeight: 1.5 }}>{label}</span>,
    composerInfo: <CreditCostNote policy={!!parseChatPolicyIntent(draft)} decision={decision} loading={false} onRetry={noop} />, maySendDraft: decision.kind === "ready",
    composerTools: <ChatModelMenu label={model || t("AI 모델 선택")} locked={false} contextKey={selected}>{modelControls}</ChatModelMenu>,
    viewport, content, input, followsLatest, setUnread: noop,
    loading: false, error: null, setHistoryRevision: noop, timeline: [], draft,
    canRun: true, online: true, updateDraft: setDraft, canEditPolicy: false, policyBusy: false, busy: false,
    confirmProposal: asyncNoop, runId: null, run: null, pastRuns: {}, events: [], active: false, streamState: "idle",
    clarification: null, onOpenResult: showPreviewNotice, unread: false, showLatest: noop, proposal: null,
    policyError: notice, submit: async event => { event.preventDefault(); setNotice(explanation); },
    sending: false, composing, onOpenAISettings: () => setPanel(t("AI 설정")),
    canCancel: false, cancelling: false, cancel: asyncNoop, modelAvailable: true,
  };
  return <div className={`workspace-shell figma-workspace conversation-workspace${collapsed ? " sidebar-collapsed" : ""}${mobileOpen ? " mobile-navigation-open" : ""}`} data-ui-fixture="synthetic-only">
    <WorkspaceChrome session={{ workspaceId: "ui-story" }}
      profile={{ id: "sample-user", displayName: "UI preview", email: "Synthetic data · No backend", status: "ACTIVE", workspaces: [{ workspaceId: "ui-story", name: locale === "en" ? "Design studio · sample" : "디자인 스튜디오 · 예시", slug: "sample", effectivePermissions: [...permissions] }] }}
      sidebarCollapsed={compact ? !mobileOpen : collapsed} compactNavigation={compact}
      setSidebarCollapsed={compact ? value => setMobileOpen(!value) : setCollapsed}
      isDarkTheme={hydrated && resolvedTheme === "dark"} setTheme={setTheme} activeView="project" streamState="idle" streamRetryCount={0} runId={null} run={null}
      activePermissions={permissions} projects={projects} selectedProjectId={selected}
      onSelectProject={project => { setSelected(project.id); setMobileOpen(false); setDraft(""); setNotice(null); }}
      onCreateProject={showPreviewNotice} navigateWorkspace={showPreviewNotice} logout={async () => showPreviewNotice()} onSwitchWorkspace={asyncNoop} />
    <main id="main-content" className="workspace-main" tabIndex={-1} aria-label={t("업무 내용")}>
      <section className="project-workbench is-chat">
        <div className="project-heading chat-project-heading"><h1>{projects.find(project => project.id === selected)?.title}</h1></div>
        <ProjectStepNavigation activeStep="agent" onStepChange={showPreviewNotice} />
        <AgentChatSurface {...surface} />
      </section>
    </main>
    {panel && <WorkspacePanel title={panel} onClose={() => setPanel(null)}><p>{explanation}</p>{panel === t("AI 설정") && modelControls}</WorkspacePanel>}
  </div>;
}
