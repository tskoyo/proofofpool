import { NextResponse } from "next/server";
import { challengeForEpoch, currentEpoch } from "@/lib/challenge";

/**
 * Hands the client the current challenge to fold into its World ID signal.
 *
 * Public by design — the challenge is not a secret, it is a rotating value. Its
 * job is to make a proof unusable in a later epoch, not to authenticate anyone.
 * Knowing it lets you build a proof for the current window, which is exactly
 * what a legitimate user does.
 */
export async function GET() {
  try {
    const epoch = currentEpoch();
    return NextResponse.json({ epoch, challenge: challengeForEpoch(epoch) });
  } catch {
    return NextResponse.json({ error: "server misconfigured: ATTESTATION_SECRET is not set" }, { status: 500 });
  }
}
