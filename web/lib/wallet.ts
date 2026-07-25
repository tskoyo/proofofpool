"use client";

import { useCallback, useEffect, useState } from "react";
import { getAddress, type Address } from "viem";
import { sepolia } from "viem/chains";

export const TARGET_CHAIN = sepolia;
const TARGET_CHAIN_HEX = `0x${TARGET_CHAIN.id.toString(16)}`;

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (payload: never) => void) => void;
  removeListener?: (event: string, handler: (payload: never) => void) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export type WalletStatus = "loading" | "unavailable" | "disconnected" | "connecting" | "connected";

/** EIP-1193 errors carry a numeric `code`; 4001 is "user rejected". */
function errorCode(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return undefined;
}

function firstAddress(accounts: unknown): Address | null {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const raw = accounts[0];
  if (typeof raw !== "string") return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

/**
 * Injected-wallet connection over EIP-1193 (MetaMask, Rabby, Brave, …).
 *
 * There is no deliberate wallet library here: `viem` is already a dependency for
 * the server-side attester, and the injected provider covers the demo path
 * without a WalletConnect project ID. The trade-off is no QR flow for mobile-only
 * wallets — swap this for wagmi + a connector kit if that becomes a requirement.
 */
export function useWallet() {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<WalletStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  // Resolve the provider only after mount — `window` doesn't exist during SSR,
  // and branching on it during render would desync hydration.
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) {
      setStatus("unavailable");
      return;
    }

    let cancelled = false;

    // `eth_accounts` reports an existing authorisation without prompting, so a
    // returning user stays connected across reloads.
    void (async () => {
      try {
        const [accounts, rawChainId] = await Promise.all([
          provider.request({ method: "eth_accounts" }),
          provider.request({ method: "eth_chainId" }),
        ]);
        if (cancelled) return;

        const next = firstAddress(accounts);
        setAddress(next);
        setStatus(next ? "connected" : "disconnected");
        if (typeof rawChainId === "string") setChainId(Number.parseInt(rawChainId, 16));
      } catch {
        if (!cancelled) setStatus("disconnected");
      }
    })();

    const onAccountsChanged = (accounts: never) => {
      const next = firstAddress(accounts);
      setAddress(next);
      setStatus(next ? "connected" : "disconnected");
      setError(null);
    };

    const onChainChanged = (rawChainId: never) => {
      if (typeof rawChainId === "string") setChainId(Number.parseInt(rawChainId, 16));
    };

    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);

    return () => {
      cancelled = true;
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) {
      setStatus("unavailable");
      return;
    }

    setError(null);
    setStatus("connecting");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const next = firstAddress(accounts);
      if (!next) {
        setStatus("disconnected");
        setError("No account was returned. Unlock your wallet and try again.");
        return;
      }
      setAddress(next);
      setStatus("connected");

      const rawChainId = await provider.request({ method: "eth_chainId" });
      if (typeof rawChainId === "string") setChainId(Number.parseInt(rawChainId, 16));
    } catch (err) {
      setStatus("disconnected");
      setError(
        errorCode(err) === 4001
          ? "Connection request rejected in your wallet."
          : "Could not connect to your wallet. Check that it's unlocked.",
      );
    }
  }, []);

  /**
   * EIP-1193 has no revoke method, so this clears local state only. The wallet
   * still lists the site as authorised until the user removes it there.
   */
  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setStatus("disconnected");
    setError(null);
  }, []);

  const switchToTargetChain = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) return;

    setError(null);
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: TARGET_CHAIN_HEX }],
      });
    } catch (err) {
      // 4902 means the wallet doesn't know this chain yet — offer to add it.
      if (errorCode(err) === 4902) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: TARGET_CHAIN_HEX,
                chainName: TARGET_CHAIN.name,
                nativeCurrency: TARGET_CHAIN.nativeCurrency,
                rpcUrls: [TARGET_CHAIN.rpcUrls.default.http[0]],
                blockExplorerUrls: [TARGET_CHAIN.blockExplorers?.default.url],
              },
            ],
          });
          return;
        } catch {
          setError(`Could not add ${TARGET_CHAIN.name} to your wallet.`);
          return;
        }
      }
      setError(
        errorCode(err) === 4001
          ? "Network switch rejected in your wallet."
          : `Could not switch to ${TARGET_CHAIN.name}.`,
      );
    }
  }, []);

  return {
    address,
    chainId,
    status,
    error,
    connect,
    disconnect,
    switchToTargetChain,
    isConnected: status === "connected" && address !== null,
    isWrongChain: chainId !== null && chainId !== TARGET_CHAIN.id,
  };
}
