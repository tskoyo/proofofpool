import { createHmac } from "node:crypto";

/**
 * Server-only. Never import this from a client component — it reads the secret.
 *
 * A World proof is a bearer token: it stays cryptographically valid forever, so
 * a saved one can be replayed to mint attestation after attestation without the
 * user ever facing the camera again. That would reduce Selfie Check to a
 * one-time human check and drop the liveness claim entirely.
 *
 * The fix is to bind each proof to a rotating challenge that the client must
 * fold into the World ID signal. The challenge is derived from the current
 * epoch, so it changes on a fixed schedule and a proof from an earlier epoch no
 * longer matches — a new allowance requires a genuinely new Selfie Check.
 *
 * Deriving rather than storing keeps this correct across restarts and across
 * multiple server instances, which an in-memory replay set is not.
 */

/** An epoch is a numbered time window: floor(now / EPOCH_SECONDS). */
export function epochSeconds(): number {
  return Number(process.env.ATTESTATION_TTL_SECONDS ?? "3600");
}

export function currentEpoch(nowSeconds = Math.floor(Date.now() / 1000)): number {
  return Math.floor(nowSeconds / epochSeconds());
}

function secret(): string {
  const value = process.env.ATTESTATION_SECRET;
  if (!value) throw new Error("ATTESTATION_SECRET is not set");
  return value;
}

/** The unguessable per-epoch value the client folds into its World ID signal. */
export function challengeForEpoch(epoch: number): string {
  return createHmac("sha256", secret()).update(`challenge:${epoch}`).digest("hex");
}

/**
 * Epochs whose challenge a proof may legitimately carry.
 *
 * The previous epoch is accepted because a user who starts verifying just before
 * a boundary finishes just after it, and rejecting them would look like a random
 * failure.
 *
 * The caller MUST derive the nonce and expiry from whichever epoch actually
 * matched, not from the current one. Deriving from the current epoch would let a
 * proof minted in epoch E be replayed in E+1 to mint a brand-new allowance —
 * reintroducing exactly the replay this module exists to prevent.
 */
export function candidateEpochs(): number[] {
  const epoch = currentEpoch();
  return [epoch, epoch - 1];
}

/**
 * The attestation nonce, derived from the human and the epoch.
 *
 * Deterministic on purpose: replaying the same proof inside one epoch rebuilds
 * the identical attestation, hence the identical EIP-712 digest, hence the same
 * partly-spent allowance. A random nonce would hand out a fresh allowance on
 * every replay and make maxSwaps decorative.
 *
 * The nullifier is passed through HMAC so the on-chain digest is not a plain
 * function of it — otherwise anyone who learned a nullifier could compute the
 * digest and follow that person's swaps.
 */
export function attestationNonce(nullifier: string, epoch: number): bigint {
  const mac = createHmac("sha256", secret()).update(`nonce:${nullifier}:${epoch}`).digest("hex");
  return BigInt(`0x${mac}`);
}

/**
 * Expiry pinned to the epoch grid, so a replay inside the window reproduces the
 * same struct rather than a longer-lived one.
 *
 * Two epochs out, not one: `epoch + 1` would give somebody who verifies at
 * 59:50 an attestation lasting ten seconds. The cost is that real validity
 * ranges from 1x to 2x the epoch length, and a user who verifies in consecutive
 * epochs briefly holds two live attestations — so the effective cap can burst to
 * 2x maxSwaps, while the sustained rate stays maxSwaps per epoch. Both are
 * deliberate; see README.md.
 */
export function attestationValidUntil(epoch: number): bigint {
  return BigInt((epoch + 2) * epochSeconds());
}
