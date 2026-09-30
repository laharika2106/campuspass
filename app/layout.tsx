import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CampusPass | Campus events & tickets",
  description: "Discover campus events, reserve your spot, and manage your digital tickets with CampusPass.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
