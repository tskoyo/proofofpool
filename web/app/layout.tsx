import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofPool — proof-of-human swap fees",
  description:
    "ProofPool charges bots and sybil wallets the standard swap fee. Verify once with World ID and every swap after gets the discounted human rate.",
  icons: { icon: "/logo-mark.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
