import { publicPageMetadata } from "../lib/site-metadata";
import { noticesTitle, noticesDescription } from "../lib/site-copy.mjs";
import { ReactNode } from "react";
import { LocaleProvider } from "../lib/ui-language";

export const metadata = publicPageMetadata("/notices", noticesTitle, noticesDescription);

export default function Layout({ children }: { children: ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>;
}
