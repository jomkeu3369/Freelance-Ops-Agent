import type { Metadata } from "next";
import { Providers } from "./providers";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Freelance Ops | 근거 있는 견적 운영",
  description: "모호한 고객 문의를 검증 가능한 요구사항과 근거 있는 견적으로 전환하는 프리랜서 업무 도구입니다.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Freelance Ops | 근거 있는 견적 운영",
    description: "흩어진 문의를, 근거 있는 견적으로.",
    type: "website",
    locale: "ko_KR",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "Freelance Ops의 살아 움직이는 견적 워크플로우" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Freelance Ops | 근거 있는 견적 운영",
    description: "흩어진 문의를, 근거 있는 견적으로.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
