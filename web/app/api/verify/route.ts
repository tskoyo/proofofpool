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
import {
  attestationNonce,
  attestationValidUntil,
  candidateEpochs,
  challengeForEpoch,
} from "@/lib/challenge";
import { rateLimit } from "@/lib/rate-limit";

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
  // Tightest of the three: every call that gets past the local checks costs a
  // request against World's verify endpoint, so this is quota protection as
  // much as abuse protection.
  const limited = rateLimit(req, "verify", 10, 60);
  if (limited) return limited;

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

  // The signal is `${address}:${challenge}`, so this single comparison enforces
  // two things at once: the proof belongs to this address, and it was produced
  // in a still-acceptable epoch.
  //
  // Which epoch matched is then carried forward — the attestation is derived
  // from THAT epoch, not the current one. Otherwise replaying an epoch-E proof
  // during E+1 would mint a fresh nonce and a fresh allowance, which is the
  // whole thing this is meant to stop.
  const proofSignalHash = selfie.signal_hash.toLowerCase();
  const matchedEpoch = candidateEpochs().find(
    (epoch) => hashSignal(`${signal}:${challengeForEpoch(epoch)}`).toLowerCase() === proofSignalHash,
  );

  if (matchedEpoch === undefined) {
    return badRequest("proof was issued for a different address or an expired challenge", {
      proof_signal_hash: selfie.signal_hash,
      expected_signal_hashes: candidateEpochs().map((epoch) =>
        hashSignal(`${signal}:${challengeForEpoch(epoch)}`),
      ),
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

  // Log worldRes.status alone if you need to debug a rejection.

  if (!worldRes.ok) {
    return badRequest("verification failed", worldBody);
  }

  const attesterKey = process.env.ATTESTER_PRIVATE_KEY as Hex | undefined;
  const oracleAddress = process.env.NEXT_PUBLIC_ORACLE_ADDRESS as Address | undefined;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");

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

  // Every field is derived from the proof's own epoch, never random and never
  // from the clock. Replaying a proof therefore rebuilds a byte-identical
  // attestation — same digest, same already-spent allowance — whether it is
  // replayed a second later or a full epoch later. A new allowance needs a new
  // challenge, which needs a new Selfie Check.
  const attestation: LivenessAttestation = {
    subject: signal,
    validUntil: attestationValidUntil(matchedEpoch),
    nonce: attestationNonce(selfie.nullifier, matchedEpoch),
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

  // The nullifier is never returned, stored, or logged next to the wallet
  // address — but it is not unused: it seeds the attestation nonce above, which
  // is what makes a replayed proof rebuild the same digest and the same spent
  // allowance. It rate-limits this wallet per epoch; it does not bind a human to
  // one wallet, which is the accepted Sybil gap in README.md.
  return NextResponse.json({
    success: true,
    attested: true,
    attestation: serializeAttestation(attestation),
    signature,
  });
}
