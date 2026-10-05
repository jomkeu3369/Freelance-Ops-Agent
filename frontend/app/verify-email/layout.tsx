import { ReactNode } from "react";
import { LocaleProvider } from "../lib/ui-language";

export default function Layout({ children }: { children: ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>;
}
