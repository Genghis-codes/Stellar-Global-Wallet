import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { themeInitScript } from "@/components/theme/ThemeProvider";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GlobeWallet", template: "%s · GlobeWallet" },
  description: "Non-custodial Stellar wallet",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f19" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-fg antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
