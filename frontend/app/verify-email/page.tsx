import type { Metadata } from "next";
import { VerifyEmailPage } from "../../features/workspace/auth/verify-email-page";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function Page() { return <VerifyEmailPage />; }
