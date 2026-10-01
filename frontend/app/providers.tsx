"use client";

import { ThemeProvider } from "next-themes";
import { LocaleProvider, SkipLink } from "./lib/ui-language";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
      <LocaleProvider><SkipLink />{children}</LocaleProvider>
    </ThemeProvider>
  );
}
