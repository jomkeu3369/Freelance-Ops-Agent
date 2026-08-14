import Link from "next/link";
import { ArrowLeft, FileDashed } from "@phosphor-icons/react/dist/ssr";

export default function NotFound() {
  return (
    <main id="main-content" className="route-state">
      <FileDashed size={40} weight="duotone" />
      <span>요청한 화면을 찾지 못했습니다.</span>
      <h1>링크가 만료되었거나 주소가 변경되었을 수 있습니다.</h1>
      <p>주소를 다시 확인하거나 Freelance Ops 홈에서 원하는 작업을 이어가세요.</p>
      <div className="state-actions">
        <Link className="primary-button" href="/"><ArrowLeft size={18} /> 홈으로 이동</Link>
        <Link className="quiet-button" href="/workspace">Workspace 열기</Link>
      </div>
    </main>
  );
}
