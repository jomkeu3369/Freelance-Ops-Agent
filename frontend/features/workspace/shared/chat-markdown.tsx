"use client";

import { isValidElement, memo, ReactNode, useMemo, useState } from "react";
import Markdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import "./chat-markdown.css";

interface ChatMarkdownProps {
  children: string;
  locale?: "ko" | "en";
}

const labels = {
  ko: {
    code: "코드",
    copy: "코드 복사",
    copied: "복사됨",
    failed: "복사하지 못했습니다. 코드를 선택해 복사해 주세요.",
    table: "표 · 좌우로 스크롤",
    image: "이미지"
  },
  en: {
    code: "Code",
    copy: "Copy code",
    copied: "Copied",
    failed: "Could not copy. Select the code and copy it manually.",
    table: "Table · scroll horizontally",
    image: "Image"
  }
};

// Markdown 기본값보다 좁은 허용 목록을 유지한다. 원시 HTML 플러그인,
// 외부 이미지, 실행 가능한 URL, 프로토콜 상대 URL, DOM 속성 일괄 전달은 허용하지 않는다.
export function safeMarkdownUrl(value: string): string {
  const url = value.trim();
  if (
    !url ||
    [...url].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === "\\")
  )
    return "";
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      return parsed.username || parsed.password ? "" : url;
    } catch {
      return "";
    }
  }
  if (/^mailto:[^?]+(?:\?[^]*)?$/i.test(url)) return url;
  if (url.startsWith("#") || /^\/(?!\/)/.test(url)) return url;
  return "";
}

function CodeBlock({ children, locale }: { children?: ReactNode; locale: "ko" | "en" }) {
  const copy = labels[locale];
  const code = isValidElement<{ children?: ReactNode; className?: string }>(children) ? children.props : null;
  const text = typeof code?.children === "string" ? code.children : "";
  const language = code?.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? copy.code;
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      setFailed(false);
    } catch {
      setCopiedText(null);
      setFailed(true);
    }
  }

  return (
    <div className="chat-markdown-code">
      <div className="chat-markdown-code-toolbar">
        <span>{language}</span>
        <button type="button" onClick={() => void copyCode()}>
          {copiedText === text ? copy.copied : copy.copy}
        </button>
      </div>
      {/* 키보드 사용자가 긴 코드 줄을 가로로 스크롤하도록 포커스를 허용한다. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <pre tabIndex={0} role="region" aria-label={`${copy.code} · ${language}`}>
        {children}
      </pre>
      <span className={failed ? "chat-markdown-copy-error" : "sr-only"} role="status">
        {failed ? copy.failed : copiedText === text ? copy.copied : ""}
      </span>
    </div>
  );
}

export const ChatMarkdown = memo(function ChatMarkdown({ children, locale = "ko" }: ChatMarkdownProps) {
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, title }) =>
        href ? (
          <a href={href} title={title} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ) : (
          <span>{children}</span>
        ),
      img: ({ alt }) => (
        <span className="chat-markdown-image">
          [{labels[locale].image}
          {alt ? `: ${alt}` : ""}]
        </span>
      ),
      pre: ({ children }) => <CodeBlock locale={locale}>{children}</CodeBlock>,
      // 이름이 있는 스크롤 영역은 키보드 가로 스크롤을 위해 탭으로 접근할 수 있어야 한다.
      table: ({ children }) => (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 키보드 가로 스크롤을 허용한다.
        <div className="chat-markdown-table" tabIndex={0} role="region" aria-label={labels[locale].table}>
          <table>{children}</table>
        </div>
      )
    }),
    [locale]
  );

  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowedElements={[
          "p",
          "br",
          "strong",
          "em",
          "del",
          "a",
          "img",
          "ul",
          "ol",
          "li",
          "blockquote",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "hr",
          "pre",
          "code",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
          "input"
        ]}
        urlTransform={(url, key) => (key === "href" ? safeMarkdownUrl(url) : "")}
        components={components}
      >
        {children}
      </Markdown>
    </div>
  );
});
