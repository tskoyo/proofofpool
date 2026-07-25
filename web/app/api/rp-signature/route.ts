import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit-core/signing";

// Signs the RP request with our Developer Portal signing key. This never runs
// on the client — leaking RP_SIGNING_KEY lets anyone impersonate this app.
export async function POST(request: Request) {
    const { action } = await request.json();

    console.log(process.env.RP_SIGNING_KEY);
    const { sig, nonce, createdAt, expiresAt } = signRequest({
        signingKeyHex: process.env.RP_SIGNING_KEY!,
        action,
    });

    return NextResponse.json({
        sig,
        nonce,
        created_at: createdAt,
        expires_at: expiresAt,
    });
}
