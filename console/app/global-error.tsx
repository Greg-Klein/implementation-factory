"use client";

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import PageError from "./error";

/** An error in the root layout replaces it: this file brings its own document, styles, fonts and theme. */
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang={DEFAULT_LANGUAGE} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body><PageError {...props} /></body>
    </html>
  );
}
