import { useEffect, useState } from "react";
import Link from "next/link";
import { freeUsageReturnPath } from "../../../app/lib/free-usage.mjs";
import { useT } from "../../../app/lib/ui-language";

export function AnalysisReturnLink() {
  const t = useT();
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    Promise.resolve().then(() => setReturnTo(freeUsageReturnPath(new URLSearchParams(window.location.search).get("returnTo"))));
  }, []);
  if (!returnTo) return null;
  return <div className="free-usage-return" role="note">
    <p>{t("연결을 등록한 뒤 프로젝트로 돌아가 사용할 키를 선택하세요. 분석은 직접 시작할 때만 실행됩니다.")}</p>
    <Link className="secondary-button" href={returnTo}>{t("작성하던 분석으로 돌아가기")}</Link>
  </div>;
}
