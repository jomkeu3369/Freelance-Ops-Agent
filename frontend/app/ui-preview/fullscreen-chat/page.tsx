import type { Metadata } from "next";
import { allowUIFixture } from "../../../features/ui-preview/fixture-guard.mjs";
import { notFound } from "next/navigation";
import { FullscreenChatFixture } from "../../../features/ui-preview/fullscreen-chat-fixture";

export const metadata: Metadata = { title: "UI preview · synthetic data", robots: { index: false, follow: false } };

export default function PreviewPage() {
  // A component story only: never enabled on main/production, never an auth fallback.
  if (!allowUIFixture(process.env)) notFound();
  return <FullscreenChatFixture />;
}
