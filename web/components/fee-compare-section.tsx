"use client";

import { Card, QuoteCompare } from "@/components/ds";
import { feeCost, useFeeTiers } from "@/lib/pool";
import { USDC, formatAmount } from "@/lib/tokens";

/** A round number to make the comparison concrete. The percentages are the real claim. */
const EXAMPLE_AMOUNT = 1000;

export function FeeCompareSection() {
  const { verifiedFee, unverifiedFee, verifiedLabel, unverifiedLabel } = useFeeTiers();

  const standardCost = feeCost(EXAMPLE_AMOUNT, unverifiedFee);
  const verifiedCost = feeCost(EXAMPLE_AMOUNT, verifiedFee);

  return (
    <section id="fees" style={{ padding: "0 48px 100px", maxWidth: 640, margin: "0 auto" }}>
      <h2 style={{ fontSize: 28, fontWeight: 600, textAlign: "center", marginBottom: 8 }}>
        Two fee tiers. One verification.
      </h2>
      <p style={{ textAlign: "center", color: "var(--text-secondary)", marginBottom: 36 }}>
        The same swap, priced differently by wallet trust. Shown on a {EXAMPLE_AMOUNT.toLocaleString("en-US")}{" "}
        {USDC.symbol} trade.
      </p>
      <Card>
        <QuoteCompare
          standard={{ fee: unverifiedLabel, amount: `${formatAmount(standardCost, USDC)} ${USDC.symbol}` }}
          verified={{ fee: verifiedLabel, amount: `${formatAmount(verifiedCost, USDC)} ${USDC.symbol}` }}
        />
        <p
          style={{
            margin: "14px 0 0",
            textAlign: "center",
            fontSize: "var(--text-body-s)",
            color: "var(--text-secondary)",
          }}
        >
          Verifying keeps{" "}
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent-primary)", fontWeight: 600 }}>
            {formatAmount(standardCost - verifiedCost, USDC)} {USDC.symbol}
          </span>{" "}
          in your pocket on a trade this size.
        </p>
      </Card>
    </section>
  );
}
