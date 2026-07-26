import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { rateLimit } from "@/lib/rate-limit";

// Signs the RP request with our Developer Portal signing key. This never runs
// on the client — leaking RP_SIGNING_KEY lets anyone impersonate this app.
//
// The action is read from the environment and NOT from the request body. An
// earlier version signed whatever action the caller sent, which on a public URL
// is an open signing oracle: anyone could obtain this app's RP signature for an
// action of their choosing and issue proof requests as us. The client already
// knows the action from NEXT_PUBLIC_WLD_ACTION, so it never needed to send it.
export async function POST(req: Request) {
  const limited = rateLimit(req, "rp-signature", 20, 60);
  if (limited) return limited;

  const signingKeyHex = process.env.RP_SIGNING_KEY;
  const action = process.env.WORLD_ACTION;

  if (!signingKeyHex || !action) {
    return NextResponse.json(
      { error: "server misconfigured: RP_SIGNING_KEY and WORLD_ACTION are required" },
      { status: 500 },
    );
  }

  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex, action });

  return NextResponse.json({
    sig,
    nonce,
    created_at: createdAt,
    expires_at: expiresAt,
  });
}
