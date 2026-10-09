import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@xterm/xterm/css/xterm.css";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

/** No title here: the page renders its own, which follows the runs (`documentTitle`). */
export const metadata: Metadata = {
  description: "Local software factory on Claude Code",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
      <body>{children}</body>
    </html>
  );
}
