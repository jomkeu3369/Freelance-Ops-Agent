import type { AgentRunView } from "@/app/lib/api";
import { useT } from "@/app/lib/ui-language";
import { petDepartmentLabels, petDepartmentResultState, petStateLabels } from "./pet-state.mjs";

type DepartmentResult = NonNullable<AgentRunView["result"]>["departmentResults"][number];

/** Present recorded department outcomes, without inventing opinions or successful work. */
export function PetDepartmentResults({ results }: { results: DepartmentResult[] }) {
  const t = useT();
  if (!results.length) return <p>{t("아직 공개할 분석 결과가 없습니다. 결과가 준비되면 여기서 확인할 수 있어요.")}</p>;
  return results.map(result => {
    const label = petDepartmentLabels[result.department as keyof typeof petDepartmentLabels] ?? result.department;
    const state = petDepartmentResultState(result);
    return <p key={result.department}>
      <strong>{t(label)} · {t(petStateLabels[state])}</strong><br />
      {result.summary}
    </p>;
  });
}
