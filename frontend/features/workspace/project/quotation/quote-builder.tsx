import { Receipt } from "@phosphor-icons/react";
import { QuoteHistory } from "./quote-history";
import { QuoteItemsEditor } from "./quote-items-editor";
import { QuoteNotices } from "./quote-notices";
import { QuotePublication } from "./quote-publication";
import { QuoteSummary } from "./quote-summary";
import { QuoteToolbar } from "./quote-toolbar";
import { ScenarioComparison } from "./scenario-comparison";
import { useQuoteBuilder, type QuoteBuilderProps } from "./use-quote-builder";
import { PetCouncil } from "../../pets/pet-council";

export function QuoteBuilder(props: QuoteBuilderProps) {
  const model = useQuoteBuilder(props);

  if (!model.canRead) {
    return (
      <div className="workspace-empty">
        <Receipt size={38} />
        <h2>이 견적을 볼 수 없습니다.</h2>
        <p>견적 조회가 필요하다면 작업 공간 관리자에게 문의해 주세요.</p>
      </div>
    );
  }

  return (
    <section className="quote-builder">
      <QuoteToolbar model={model} />
      <QuoteNotices model={model} />
      <ScenarioComparison model={model} />
      <PetCouncil key={`${props.session.workspaceId}:${props.session.userId}:${props.project.id}`} model={model} session={props.session} />
      <div className="quote-layout">
        <QuoteItemsEditor model={model} />
        <QuoteSummary model={model} />
      </div>
      <QuotePublication model={model} />
      <QuoteHistory model={model} />
    </section>
  );
}
