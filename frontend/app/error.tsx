"use client";

import Link from "next/link";
import { ArrowClockwise, Warning } from "@phosphor-icons/react";
import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Frontend route error", error);
  }, [error]);

  return (
    <main id="main-content" className="route-state" role="alert">
      <Warning size={40} weight="duotone" />
      <span>화면을 표시하지 못했습니다.</span>
      <h1>작업 내용은 그대로 두고 다시 연결해 보세요.</h1>
      <p>일시적인 네트워크 또는 화면 오류일 수 있습니다. 문제가 계속되면 홈으로 돌아가 다시 시작할 수 있습니다.</p>
      {error.digest && <code>오류 참조 {error.digest}</code>}
      <div className="state-actions">
        <button type="button" className="primary-button" onClick={reset}><ArrowClockwise size={18} /> 다시 시도</button>
        <Link className="quiet-button" href="/">홈으로 이동</Link>
      </div>
    </main>
  );
}
