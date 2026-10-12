import { privateMetadata } from "../lib/site-metadata";

export const metadata = privateMetadata;

import { ReactNode } from "react";
import { LocaleProvider } from "../lib/ui-language";

export default function Layout({ children }: { children: ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>;
}
