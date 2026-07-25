import { NextResponse } from "next/server";
import { createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { registryAbi, REGISTRY_ADDRESS } from "@/lib/registry";

// Selfie Check returns a World ID 3.0 Face proof — there is no on-chain groupId
// for it (only Orb is on-chain, groupId = 1), so we verify it here against
// World's v4 REST endpoint and attest the result on-chain ourselves.
const WORLD_VERIFY_URL = (rpId: string) =>
    `https://developer.world.org/api/v4/verify/${rpId}`;

interface SelfieResponseItem {
    identifier: string;
    signal_hash?: string;
    proof: string;
    merkle_root: string;
    nullifier: string;
}

interface VerifyRequestBody {
    signal: string;
    // The exact object IDKit's `handleVerify` received — forwarded to World
    // byte-for-byte, per the v4 verify contract.
    result: {
        protocol_version: string;
        responses: SelfieResponseItem[];
    };
}

export async function POST(req: Request) {
    const rpId = process.env.NEXT_PUBLIC_WLD_RP_ID;
    const attesterKey = process.env.ATTESTER_PRIVATE_KEY as `0x${string}` | undefined;
    const rpcUrl = process.env.RPC_URL;

    if (!rpId || !attesterKey || !rpcUrl || !REGISTRY_ADDRESS) {
        return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
    }

    const body = (await req.json()) as VerifyRequestBody;
    const { signal, result } = body;

    if (!signal || !isAddress(signal) || !result) {
        return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }

    if (result.protocol_version !== "3.0") {
        return NextResponse.json({ error: "unexpected protocol version" }, { status: 400 });
    }

    const selfie = result.responses.find((r) => r.identifier === "selfie");
    if (!selfie) {
        return NextResponse.json({ error: "no selfie credential in response" }, { status: 400 });
    }

    // `signal_hash` is a public input of the ZK proof — the client baked
    // hashSignal(address) into it via `selfieCheckLegacy({ signal: address })`.
    // We compare it against the `signal` we're about to register rather than
    // trusting it implicitly: if the request body's `signal` were swapped for a
    // different address, the derived hash would stop matching the one already
    // embedded in the proof, and we reject before ever calling World.
    if (selfie.signal_hash !== hashSignal(signal)) {
        return NextResponse.json({ error: "signal mismatch" }, { status: 400 });
    }

    const worldRes = await fetch(WORLD_VERIFY_URL(rpId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Forward exactly what IDKit returned — do not re-encode or trim it.
        body: JSON.stringify(result),
    });

    if (!worldRes.ok) {
        const detail = await worldRes.json().catch(() => ({}));
        return NextResponse.json({ error: "verification failed", detail }, { status: 400 });
    }

    const account = privateKeyToAccount(attesterKey);
    const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(rpcUrl),
    });

    const nullifierHash = BigInt(selfie.nullifier);

    try {
        const txHash = await walletClient.writeContract({
            address: REGISTRY_ADDRESS,
            abi: registryAbi,
            functionName: "registerVerifiedHuman",
            args: [signal as `0x${string}`, nullifierHash],
        });

        return NextResponse.json({ success: true, txHash });
    } catch (err) {
        // Most likely DuplicateNullifier — this address/human already registered.
        return NextResponse.json(
            { error: "registration failed", detail: (err as Error).message },
            { status: 400 },
        );
    }
}
