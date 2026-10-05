import { ReactNode } from "react";
import Link from "next/link";
import { LocaleProvider } from "../lib/ui-language";
import "../../features/admin/member-admin.css";

export default function Layout({ children }: { children: ReactNode }) {
  return <LocaleProvider><nav className="admin-navigation" aria-label="관리자 메뉴"><Link href="/admin/members">회원 및 활동</Link><Link href="/admin">사용량 한도</Link><Link href="/admin/notices">운영 공지</Link></nav>{children}</LocaleProvider>;
}
