import type { Metadata } from "next";
import "./globals.css";
import { AttestationProvider } from "@/lib/attestation";

export const metadata: Metadata = {
  title: "ProofPool — proof-of-human swap fees",
  description:
    "ProofPool charges anonymous wallets the standard swap fee and hands the difference to LPs. Pass a World ID Selfie Check and your next swaps get the discounted human rate.",
  icons: { icon: "/logo-mark.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Above the pages so the attestation survives client-side navigation
          from /verify to /swap — a route change unmounts page components. */}
      <body>
        <AttestationProvider>{children}</AttestationProvider>
      </body>
    </html>
  );
}
