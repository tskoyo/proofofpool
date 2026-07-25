"use client";

import Link from "next/link";
import { Banner, Button, Card } from "@/components/ds";
import { formatUnits } from "@/lib/erc20";
import {
  DEMO_TOKEN0,
  DEMO_TOKEN1,
  HOOK_ADDRESS,
  useDemoPoolStats,
  useFeeTiers,
  type DemoPoolStats,
} from "@/lib/pool";
import { TARGET_CHAIN } from "@/lib/wallet";
import type { Token } from "@/lib/tokens";

function percent(part: bigint, total: bigint): string {
  if (total === 0n) return "0.0%";
  return `${(Number((part * 1_000n) / total) / 10).toFixed(1)}%`;
}

function estimatedPremium(volume: bigint, verifiedFee: number, unverifiedFee: number): bigint {
  return (volume * BigInt(unverifiedFee - verifiedFee)) / 1_000_000n;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card>
      <div
        style={{
          color: "var(--text-tertiary)",
          fontSize: "var(--text-caption)",
          fontWeight: 600,
          letterSpacing: "var(--tracking-wide)",
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "clamp(28px, 5vw, 38px)",
          fontWeight: 600,
          letterSpacing: "var(--tracking-tight)",
          marginBottom: 6,
        }}
      >
        {value}
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-body-s)" }}>{detail}</div>
    </Card>
  );
}

function VolumeCard({
  token,
  verified,
  unverified,
  verifiedFee,
  unverifiedFee,
}: {
  token: Token;
  verified: bigint;
  unverified: bigint;
  verifiedFee: number;
  unverifiedFee: number;
}) {
  const premium = estimatedPremium(unverified, verifiedFee, unverifiedFee);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 22 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "var(--text-heading-s)", marginBottom: 4 }}>{token.symbol}</div>
          <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-caption)" }}>
            Requested exact-input volume
          </div>
        </div>
        <span
          style={{
            alignSelf: "flex-start",
            borderRadius: 999,
            background: "var(--surface-sunken)",
            color: "var(--text-secondary)",
            fontSize: "var(--text-caption)",
            padding: "5px 9px",
          }}
        >
          raw on-chain
        </span>
      </div>

      {[
        { label: "Verified flow", value: verified, color: "var(--accent-primary)" },
        { label: "Unverified flow", value: unverified, color: "var(--amber-600)" },
      ].map((row) => (
        <div
          key={row.label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            padding: "11px 0",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <span style={{ color: row.color, fontSize: "var(--text-body-s)", fontWeight: 600 }}>{row.label}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-body-s)" }}>
            {formatUnits(row.value, token)} {token.symbol}
          </span>
        </div>
      ))}

      <div style={{ marginTop: 18 }}>
        <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-caption)", marginBottom: 5 }}>
          Estimated unverified fee premium
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-primary)" }}>
          {formatUnits(premium, token)} {token.symbol}
        </div>
      </div>
    </Card>
  );
}

function Stats({ stats }: { stats: DemoPoolStats }) {
  const { verifiedFee, unverifiedFee, verifiedLabel, unverifiedLabel } = useFeeTiers();
  const verifiedShare = percent(stats.verifiedSwaps, stats.totalSwaps);
  const unverifiedShare = percent(stats.unverifiedSwaps, stats.totalSwaps);

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 16,
        }}
      >
        <Metric label="Total swaps" value={stats.totalSwaps.toLocaleString("en-US")} detail="All priced pool swaps" />
        <Metric
          label="Verified swaps"
          value={stats.verifiedSwaps.toLocaleString("en-US")}
          detail={`${verifiedShare} of traffic · ${verifiedLabel} fee`}
        />
        <Metric
          label="Unverified swaps"
          value={stats.unverifiedSwaps.toLocaleString("en-US")}
          detail={`${unverifiedShare} of traffic · ${unverifiedLabel} fee`}
        />
      </div>

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>Traffic split by fee tier</span>
          <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-caption)" }}>
            {verifiedShare} verified
          </span>
        </div>
        <div
          aria-label={`${verifiedShare} verified and ${unverifiedShare} unverified`}
          style={{
            height: 14,
            display: "flex",
            overflow: "hidden",
            borderRadius: 999,
            background: "var(--surface-sunken)",
          }}
        >
          <div style={{ width: verifiedShare, background: "var(--accent-primary)" }} />
          <div style={{ flex: 1, background: "var(--amber-600)" }} />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            marginTop: 12,
            color: "var(--text-secondary)",
            fontSize: "var(--text-body-s)",
          }}
        >
          <span>Verified · {verifiedShare}</span>
          <span>Unverified · {unverifiedShare}</span>
        </div>
      </Card>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
          marginTop: 16,
        }}
      >
        <VolumeCard
          token={DEMO_TOKEN0}
          verified={stats.verifiedInputVolume0}
          unverified={stats.unverifiedInputVolume0}
          verifiedFee={verifiedFee}
          unverifiedFee={unverifiedFee}
        />
        <VolumeCard
          token={DEMO_TOKEN1}
          verified={stats.verifiedInputVolume1}
          unverified={stats.unverifiedInputVolume1}
          verifiedFee={verifiedFee}
          unverifiedFee={unverifiedFee}
        />
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { stats, state, updatedAt, refresh, poolId } = useDemoPoolStats();

  return (
    <>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
          padding: "20px 28px",
          borderBottom: "1px solid var(--border-subtle)",
          flexWrap: "wrap",
        }}
      >
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-lockup.svg" alt="ProofPool" style={{ height: 24, display: "block" }} />
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Link
            href="/swap"
            style={{
              color: "var(--text-secondary)",
              textDecoration: "none",
              fontSize: "var(--text-body-s)",
              fontWeight: 500,
            }}
          >
            Swap
          </Link>
          <Button variant="secondary" size="s" onClick={() => void refresh()}>
            Refresh data
          </Button>
        </div>
      </header>

      <main style={{ maxWidth: 1040, margin: "0 auto", padding: "64px 24px 96px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 24,
            flexWrap: "wrap",
            marginBottom: 28,
          }}
        >
          <div>
            <div
              style={{
                color: "var(--accent-primary)",
                fontSize: "var(--text-caption)",
                fontWeight: 600,
                letterSpacing: "var(--tracking-wide)",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Sepolia · live contract reads
            </div>
            <h1
              style={{
                fontSize: "clamp(34px, 7vw, 52px)",
                letterSpacing: "var(--tracking-tight)",
                lineHeight: 1.08,
                margin: "0 0 12px",
              }}
            >
              Pool activity
            </h1>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 620, margin: 0 }}>
              A direct view of how ProofPool priced verified and unverified swaps through its Uniswap v4 Hook.
            </p>
          </div>
          <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-caption)", textAlign: "right" }}>
            <div>{state === "live" ? "● Live · refreshes every 15s" : "○ Waiting for contract data"}</div>
            {updatedAt && <div style={{ marginTop: 5 }}>Updated {updatedAt.toLocaleTimeString()}</div>}
          </div>
        </div>

        <Banner tone="warning" title="Demo data disclosure" style={{ marginBottom: 24 }}>
          Most traffic shown here was synthetically generated for demonstration purposes, so judges can clearly
          compare verified and unverified fee behavior. Live demo swaps are included as well.
        </Banner>

        {state === "unconfigured" && (
          <Banner tone="info" title="Hook not configured">
            Set NEXT_PUBLIC_HOOK_ADDRESS to the newly deployed Hook to load its demo statistics.
          </Banner>
        )}

        {state === "error" && (
          <Banner tone="warning" title="Could not read demo statistics">
            The configured Hook may predate the demoPoolStats getter. Redeploy the updated Hook and check
            NEXT_PUBLIC_HOOK_ADDRESS and NEXT_PUBLIC_RPC_URL.
          </Banner>
        )}

        {state === "loading" && (
          <Card style={{ textAlign: "center", color: "var(--text-secondary)", padding: "56px 24px" }}>
            Reading pool activity from Sepolia…
          </Card>
        )}

        {state === "live" && stats && <Stats stats={stats} />}

        <div
          style={{
            marginTop: 24,
            paddingTop: 18,
            borderTop: "1px solid var(--border-subtle)",
            color: "var(--text-tertiary)",
            fontSize: "var(--text-caption)",
            lineHeight: 1.6,
          }}
        >
          Volumes are requested exact-input amounts in each token&rsquo;s native units, not settled volume. Exact-output
          swaps are included in swap counts but excluded from volume. Estimated premium applies the difference
          between the {stats ? "live" : "configured"} fee tiers to unverified input volume.
          {HOOK_ADDRESS && poolId && (
            <>
              {" "}
              <a
                href={`${TARGET_CHAIN.blockExplorers?.default.url}/address/${HOOK_ADDRESS}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                View Hook contract
              </a>
              .
            </>
          )}
        </div>
      </main>
    </>
  );
}
