import { useT, LanguageSelector } from "../../../app/lib/ui-language";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { StoryMark } from "./reference-story";
import { List, Moon, Sun, X } from "@phosphor-icons/react";
import { useTheme } from "next-themes";

// 서버 렌더링과 첫 브라우저 렌더링의 테마 아이콘을 동일하게 유지합니다.
const subscribeToHydration = () => () => undefined;

export function HomeHeader() {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const themeMounted = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = themeMounted && resolvedTheme === "dark";
  useEffect(() => {
    if (!menuOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [menuOpen]);
  function closeMenu(target: string) {
    setMenuOpen(false);
    document.querySelector<HTMLElement>(target)?.focus({ preventScroll: true });
  }

  return (
    <header className="nav-shell" aria-label={t("주요 탐색")} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
    }}>
      <Link className="brand" href="#top" aria-label={t("Freelance Ops 홈")}>
        <StoryMark className="brand-mark" />
        <span className="brand-wordmark">Freelance Ops</span>
      </Link>
      <button ref={menuButton} type="button" className="icon-button home-menu-toggle" aria-label={menuOpen ? t("페이지 메뉴 닫기") : t("페이지 메뉴 열기")} aria-expanded={menuOpen} aria-controls="home-navigation" onClick={() => setMenuOpen((open) => !open)}>
        {menuOpen ? <X size={20} /> : <List size={20} />}
      </button>
      <nav id="home-navigation" className={`nav-links${menuOpen ? " is-open" : ""}`} aria-label={t("페이지 이동")}>
        <a href="#product" onClick={() => closeMenu("#product")}>{t("제품 소개")}</a>
        <a href="#workflow" onClick={() => closeMenu("#workflow")}>{t("작동 방식")}</a>
        <a href="#evidence" onClick={() => closeMenu("#evidence")}>{t("검증 원칙")}</a>
        <a href="#audience" onClick={() => closeMenu("#audience")}>{t("대상 사용자")}</a>
      </nav>
      <div className="nav-actions">
        <LanguageSelector />
        <button
          className="icon-button"
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label={isDark ? t("라이트 모드로 전환") : t("다크 모드로 전환")}
        >
          {isDark ? <Sun size={19} weight="bold" /> : <Moon size={19} weight="bold" />}
        </button>
        <Link className="text-link" href="/workspace">{t("로그인")}</Link>
        <Link className="primary-button compact" href="/workspace">{t("요구사항 정리 시작하기")}</Link>
      </div>
    </header>
  );
}
