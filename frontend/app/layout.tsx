import type { Metadata } from "next";
import { rootMetadata } from "./lib/site-metadata";
import { Providers } from "./providers";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

export const metadata: Metadata = rootMetadata;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
