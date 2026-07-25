import Link from "next/link";
import { Button, Card, Icon } from "@/components/ds";
import type { IconName } from "@/components/ds";
import { FeeCompareSection } from "@/components/fee-compare-section";

const navLinkStyle = {
    color: "var(--text-secondary)",
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 500,
} as const;

function Nav() {
    return (
        <nav
            style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 24,
                padding: "20px 48px",
                position: "sticky",
                top: 0,
                background: "rgba(250,249,246,.85)",
                backdropFilter: "blur(8px)",
                zIndex: 10,
                borderBottom: "1px solid var(--border-subtle)",
                flexWrap: "wrap",
            }}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-lockup.svg" alt="ProofPool" style={{ height: 28 }} />
            <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
                <a href="#how" style={navLinkStyle}>
                    How it works
                </a>
                <a href="#fees" style={navLinkStyle}>
                    Fees
                </a>
                <Link href="/dashboard" style={navLinkStyle}>
                    Live stats
                </Link>
                <Link href="/swap" style={navLinkStyle}>
                    Launch app
                </Link>
            </div>
        </nav>
    );
}

function Hero() {
    return (
        <section style={{ padding: "110px 48px 90px", maxWidth: 820, margin: "0 auto", textAlign: "center" }}>
            <div
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 14px",
                    borderRadius: 999,
                    background: "var(--accent-primary-soft)",
                    color: "var(--green-700)",
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 28,
                }}
            >
                Built on Uniswap v4 hooks
            </div>
            <h1
                style={{
                    fontSize: "clamp(36px, 8vw, 56px)",
                    fontWeight: 700,
                    letterSpacing: "var(--tracking-tight)",
                    lineHeight: 1.08,
                    margin: "0 0 24px",
                }}
            >
                Prove you&rsquo;re human. Pay a lower fee.
            </h1>
            <p
                style={{
                    fontSize: 19,
                    color: "var(--text-secondary)",
                    lineHeight: 1.6,
                    maxWidth: 560,
                    margin: "0 auto 40px",
                }}
            >
                ProofPool charges anonymous wallets the standard swap fee and hands the difference to LPs. Pass a
                World ID Selfie Check and your next swaps get the discounted human rate.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                <Link href="/swap" style={{ textDecoration: "none" }}>
                    <Button variant="accent" size="l">
                        Launch app
                    </Button>
                </Link>
                <Link href="/verify" style={{ textDecoration: "none" }}>
                    <Button variant="secondary" size="l">
                        Verify with World ID
                    </Button>
                </Link>
            </div>
        </section>
    );
}

const steps: { icon: IconName; t: string; d: string }[] = [
    { icon: "wallet", t: "Connect your wallet", d: "Any standard EVM wallet works — no new account needed." },
    {
        icon: "scan-face",
        t: "Verify with World ID",
        d: "A Selfie Check proves a live human is present, without linking your identity to your wallet.",
    },
    {
        icon: "shield-check",
        t: "Swap at the human rate",
        d: "You carry a signed attestation to the pool. It covers a set number of swaps before it expires — verify again for more.",
    },
];

function HowItWorks() {
    return (
        <section id="how" style={{ padding: "0 48px 110px", maxWidth: 960, margin: "0 auto" }}>
            <h2 style={{ fontSize: 28, fontWeight: 600, textAlign: "center", marginBottom: 44 }}>
                How verification works
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 20 }}>
                {steps.map((s) => (
                    <Card key={s.t}>
                        <Icon
                            name={s.icon}
                            size={24}
                            style={{ color: "var(--accent-primary)", marginBottom: 14, display: "block" }}
                        />
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>{s.t}</div>
                        <div style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.55 }}>{s.d}</div>
                    </Card>
                ))}
            </div>
        </section>
    );
}

function FooterSection() {
    return (
        <footer
            style={{
                background: "var(--ink-900)",
                color: "var(--paper-0)",
                padding: "56px 48px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 24,
                flexWrap: "wrap",
            }}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-lockup-dark.svg" alt="ProofPool" style={{ height: 26 }} />
            <div style={{ color: "var(--ink-300)", fontSize: 13 }}>
                Proof-of-human swap fees, built on Uniswap v4.
            </div>
        </footer>
    );
}

export default function Home() {
    return (
        <>
            <Nav />
            <Hero />
            <FeeCompareSection />
            <HowItWorks />
            <FooterSection />
        </>
    );
}
