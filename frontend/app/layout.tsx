import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

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
    images: [{ url: "/freelance-ops-social.png", width: 1732, height: 909, alt: "Freelance Ops 작업 흐름" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Freelance Ops | 근거 있는 견적 운영",
    description: "흩어진 문의를, 근거 있는 견적으로.",
    images: ["/freelance-ops-social.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
