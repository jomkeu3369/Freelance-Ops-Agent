import { useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { Moon, Sun } from "@phosphor-icons/react";
import { useTheme } from "next-themes";

// 서버 렌더링과 첫 브라우저 렌더링의 테마 아이콘을 동일하게 유지합니다.
const subscribeToHydration = () => () => undefined;

export function HomeHeader() {
  const themeMounted = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = themeMounted && resolvedTheme === "dark";

  return (
    <header className="nav-shell" aria-label="주요 탐색">
      <Link className="brand" href="#top" aria-label="Freelance Ops 홈">
        <Image src="/figma/logo.svg" alt="" width={32} height={32} />
        <span className="brand-wordmark">Freelance Ops</span>
      </Link>
      <nav className="nav-links" aria-label="페이지 이동">
        <a href="#product">제품 소개</a>
        <a href="#workflow">작동 방식</a>
        <a href="#evidence">검증 원칙</a>
        <a href="#audience">대상 사용자</a>
      </nav>
      <div className="nav-actions">
        <button
          className="icon-button"
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
        >
          {isDark ? <Sun size={19} weight="bold" /> : <Moon size={19} weight="bold" />}
        </button>
        <Link className="text-link" href="/workspace">로그인</Link>
        <Link className="primary-button compact" href="/workspace">요구사항 정리 시작하기</Link>
      </div>
    </header>
  );
}
