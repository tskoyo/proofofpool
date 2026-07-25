/**
 * Anti-replay for World proofs, server-side only.
 *
 * WHY THIS EXISTS: a proof response can be captured and re-submitted. Nothing in
 * the proof itself is single-use, and World's cloud verify only rejects a repeat
 * if the action's max-verifications limit is set — which is usually raised during
 * development. Without this, anyone could replay their own saved proof to mint a
 * fresh attestation (new nonce, new digest) on demand and reset `maxSwaps` at
 * will, making the swap cap decorative.
 *
 * WHY NOT A PLAIN "SEEN NULLIFIERS" SET: nullifiers are deterministic per
 * (human, action), so the same person produces the same nullifier every time.
 * Rejecting every repeat would mean nobody could ever re-verify after using up
 * their allowance. The rule is instead "one live attestation per human": a new
 * one may only be issued once the previous has expired.
 *
 * LIMITATION: this is process-local memory. It is cleared by a restart, and does
 * not hold across multiple server instances. Production needs a real store with
 * `UNIQUE (action, nullifier)` and a NUMERIC(78,0) column.
 */
const issuedUntil = new Map<string, number>();

/** Drop expired entries so the map doesn't grow without bound. */
function prune(now: number) {
  for (const [nullifier, expiry] of issuedUntil) {
    if (expiry <= now) issuedUntil.delete(nullifier);
  }
}

/**
 * Reserve the right to issue an attestation for this nullifier.
 *
 * @returns `ok` false when the human still holds a live attestation, with
 *          `retryAfter` as the unix second their current one expires.
 */
export function reserveAttestation(
  nullifier: string,
  validUntilSeconds: number,
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Math.floor(Date.now() / 1000);
  prune(now);

  const existing = issuedUntil.get(nullifier);
  if (existing !== undefined && existing > now) {
    return { ok: false, retryAfter: existing };
  }

  issuedUntil.set(nullifier, validUntilSeconds);
  return { ok: true };
}
