import { NextResponse } from "next/server";
import { isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import {
  ATTESTATION_TYPES,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  serializeAttestation,
  type LivenessAttestation,
} from "@/lib/attestation-types";
import { reserveAttestation } from "@/lib/nullifier-store";

// Selfie Check has no on-chain verifier (only Orb does, groupId = 1), so the
// proof is verified here against World's cloud endpoint and the result attested
// by signing an EIP-712 struct the user carries to the pool. This route never
// sends a transaction: the user pays their own gas by presenting the
// attestation on each swap.
//
// The v4 endpoint is keyed by rp_id, not app_id, and takes the IDKit result
// object verbatim as its request body — the shapes are identical. Do not
// re-encode, rename, or trim fields before forwarding: `proof` and `signal_hash`
// are public inputs of the ZK proof, so any mutation invalidates it.
const WORLD_VERIFY_URL = (rpId: string) => `https://developer.world.org/api/v4/verify/${rpId}`;

// World App returns "face" for a Selfie Check credential, even though IDKit's
// own type docs give the example as "selfie". Accept both rather than pinning
// whichever one happens to be current.
const SELFIE_IDENTIFIERS = ["face", "selfie"];

/** The subset of IDKitResultV3 / ResponseItemV3 this route inspects. */
interface ResponseItem {
  identifier: string;
  signal_hash?: string;
  proof: string;
  merkle_root: string;
  nullifier: string;
}

interface IDKitResultBody {
  protocol_version: string;
  nonce: string;
  action?: string;
  environment?: string;
  responses: ResponseItem[];
}

interface VerifyRequestBody {
  signal: string;
  result: IDKitResultBody;
}

function badRequest(error: string, detail?: unknown) {
  // Every rejection below happens before the proof reaches World, so without
  // this line the only symptom is a generic "Verification declined" dialog.
  console.warn("[verify] rejected:", error, detail === undefined ? "" : JSON.stringify(detail));
  return NextResponse.json(detail === undefined ? { error } : { error, detail }, { status: 400 });
}

export async function POST(req: Request) {
  const rpId = process.env.WORLD_RP_ID;
  const expectedAction = process.env.WORLD_ACTION;
  const expectedEnvironment = process.env.WORLD_ENVIRONMENT;

  // Only the World-verification config is required to get this far. The signing
  // config is checked after verification, so the proof flow can be exercised
  // before the contracts exist.
  if (!rpId || !expectedAction) {
    return NextResponse.json(
      { error: "server misconfigured: WORLD_RP_ID and WORLD_ACTION are required" },
      { status: 500 },
    );
  }

  const { signal, result } = (await req.json()) as VerifyRequestBody;

  // Shape of what actually arrived, so a rejection below can be traced to a
  // concrete field rather than guessed at. No secrets here: signal_hash and the
  // nullifier are public inputs, and the proof itself is omitted.
  console.log(
    "[verify] received:",
    JSON.stringify({
      signal,
      protocol_version: result?.protocol_version,
      action: result?.action,
      environment: result?.environment,
      responses: result?.responses?.map((r) => ({
        identifier: r.identifier,
        signal_hash: r.signal_hash ?? null,
      })),
      expected: { action: expectedAction, environment: expectedEnvironment ?? "(unchecked)" },
      derived_signal_hash: signal && isAddress(signal) ? hashSignal(signal) : null,
    }),
  );

  if (!signal || !isAddress(signal) || !result || !Array.isArray(result.responses)) {
    return badRequest("invalid request");
  }

  // selfieCheckLegacy is a v3 preset, so World App answers with a legacy proof.
  if (result.protocol_version !== "3.0") {
    return badRequest(`unexpected protocol version: ${result.protocol_version}`);
  }

  const selfie = result.responses.find((r) => SELFIE_IDENTIFIERS.includes(r.identifier));
  if (!selfie) {
    return badRequest("no selfie credential in proof", {
      got: result.responses.map((r) => r.identifier),
      expected: SELFIE_IDENTIFIERS,
    });
  }

  // Bind the proof to the address we're about to register. `signal_hash` is a
  // public input baked into the proof by `selfieCheckLegacy({ signal: address })`,
  // so comparing it against a locally derived hash is what stops a caller from
  // pairing someone else's valid proof with an address of their choosing.
  // Under the v4 "forward verbatim" contract we can't inject our own hash, so
  // this assertion is the only thing enforcing that binding — do not remove it.
  if (!selfie.signal_hash) {
    return badRequest("proof is not bound to a signal");
  }
  if (selfie.signal_hash.toLowerCase() !== hashSignal(signal).toLowerCase()) {
    return badRequest("proof was issued for a different address", {
      proof_signal_hash: selfie.signal_hash,
      expected_signal_hash: hashSignal(signal),
      signal,
    });
  }

  // Neither of these is checked by the verify endpoint on our behalf: without
  // them a proof minted for another action, or in staging, would be accepted here.
  if (result.action !== expectedAction) {
    return badRequest(`proof is for action "${result.action}", expected "${expectedAction}"`);
  }
  if (expectedEnvironment && result.environment !== expectedEnvironment) {
    return badRequest(
      `proof is from the "${result.environment}" environment, expected "${expectedEnvironment}"`,
    );
  }

  const worldRes = await fetch(WORLD_VERIFY_URL(rpId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  });

  const worldBody: unknown = await worldRes.json().catch(() => null);

  // TODO(pre-launch): drop this. It exists to capture the real v4 response shape
  // on the first sandbox run; the body carries a nullifier, so it shouldn't be
  // logged next to a wallet address in production.
  console.log("[world-verify]", worldRes.status, JSON.stringify(worldBody));

  if (!worldRes.ok) {
    return badRequest("verification failed", worldBody);
  }

  const attesterKey = process.env.ATTESTER_PRIVATE_KEY as Hex | undefined;
  const oracleAddress = process.env.NEXT_PUBLIC_ORACLE_ADDRESS as Address | undefined;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");
  const ttlSeconds = Number(process.env.ATTESTATION_TTL_SECONDS ?? "3600");

  // The proof is valid; signing is a separate concern. Report success rather
  // than failing when the signing side isn't configured yet.
  if (!attesterKey || !oracleAddress) {
    return NextResponse.json({
      success: true,
      attested: false,
      reason: "signing not configured: set ATTESTER_PRIVATE_KEY and NEXT_PUBLIC_ORACLE_ADDRESS",
    });
  }

  const account = privateKeyToAccount(attesterKey);
  const validUntil = Math.floor(Date.now() / 1000) + ttlSeconds;

  // A verified proof is not single-use: replaying a captured one would mint a
  // fresh nonce, hence a fresh digest, hence a reset swap allowance. Allow at
  // most one live attestation per human so the cap can't be farmed.
  const reservation = reserveAttestation(selfie.nullifier, validUntil);
  if (!reservation.ok) {
    return badRequest("an attestation for this person is still active", {
      retryAfter: reservation.retryAfter,
    });
  }

  const attestation: LivenessAttestation = {
    subject: signal,
    validUntil: BigInt(validUntil),
    // Random, so re-verifying after expiry produces a different digest and
    // therefore a fresh swap allowance instead of resuming an exhausted one.
    nonce: BigInt(`0x${crypto.randomUUID().replace(/-/g, "")}`),
  };

  // The signature is bound to this specific oracle deployment through the
  // domain's verifyingContract and chainId — it cannot be replayed against
  // another deployment or another chain.
  const signature = await account.signTypedData({
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract: oracleAddress,
    },
    types: ATTESTATION_TYPES,
    primaryType: "LivenessAttestation",
    message: attestation,
  });

  // The World nullifier is deliberately not included and not stored anywhere:
  // nothing enforces one-human-one-address, which is the accepted Sybil gap in
  // README.md. It is also not logged next to the wallet address.
  return NextResponse.json({
    success: true,
    attested: true,
    attestation: serializeAttestation(attestation),
    signature,
  });
}
