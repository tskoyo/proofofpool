import { NextResponse } from "next/server";
import { createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { registryAbi, REGISTRY_ADDRESS } from "@/lib/registry";

// Selfie Check returns a World ID 3.0 Face proof — there is no on-chain groupId
// for it (only Orb is on-chain, groupId = 1), so we verify it here against
// World's legacy REST endpoint and attest the result on-chain ourselves.
const WORLD_VERIFY_URL = (appId: string) =>
    `https://developer.world.org/api/v2/verify/${appId}`;

interface VerifyRequestBody {
    signal: string;
    idkitResponse: {
        proof: string;
        merkle_root: string;
        nullifier_hash: string;
        verification_level: string;
    };
}

export async function POST(req: Request) {
    const appId = process.env.WORLD_APP_ID;
    const action = process.env.WORLD_ACTION;
    const attesterKey = process.env.ATTESTER_PRIVATE_KEY as `0x${string}` | undefined;
    const rpcUrl = process.env.RPC_URL;

    if (!appId || !action || !attesterKey || !rpcUrl || !REGISTRY_ADDRESS) {
        return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
    }

    const body = (await req.json()) as VerifyRequestBody;
    const { signal, idkitResponse } = body;

    if (!signal || !isAddress(signal) || !idkitResponse) {
        return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }

    // `signal_hash` is a public input of the ZK proof — the client baked
    // hashSignal(address) into it via `selfieCheckLegacy({ signal: address })`.
    // We derive it here from the `signal` we're about to register rather than
    // trusting a client-supplied hash: if the request body's `signal` is swapped
    // for a different address, the derived hash stops matching the one inside
    // the proof and World rejects the verification. Forwarding a client-provided
    // signal_hash would leave that substitution undetected.
    const signalHash = hashSignal(signal);

    const worldRes = await fetch(WORLD_VERIFY_URL(appId), {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.WORLD_API_KEY}`,
        },
        body: JSON.stringify({
            nullifier_hash: idkitResponse.nullifier_hash,
            proof: idkitResponse.proof,
            merkle_root: idkitResponse.merkle_root,
            verification_level: idkitResponse.verification_level,
            signal_hash: signalHash,
            action,
        }),
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

    const nullifierHash = BigInt(idkitResponse.nullifier_hash);

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
