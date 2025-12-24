export type Eip1193Provider = {
  request: (args: { method: string; params?: any[] | object }) => Promise<any>;
  on?: (event: string, cb: (...args: any[]) => void) => void;
  removeListener?: (event: string, cb: (...args: any[]) => void) => void;
};

/**
 * IMPORTANT:
 * In Base.dev Preview + Base App containers, the "correct" provider is usually exposed via Farcaster miniapp SDK.
 * If we pick window.ethereum first, desktop MetaMask can hijack the flow and break wallet_sendCalls (ERC-5792).
 */
export async function getProvider(): Promise<Eip1193Provider | null> {
  // 1) Prefer Mini App SDK provider (Base / Farcaster container)
  try {
    const mod: any = await import("https://esm.sh/@farcaster/miniapp-sdk");
    const sdk = mod?.default ?? mod;
    if (sdk?.wallet?.getEthereumProvider) {
      const p = await sdk.wallet.getEthereumProvider();
      if (p?.request) return p as Eip1193Provider;
    }
  } catch {}

  // 2) Fallback: older frame-sdk containers
  try {
    const mod: any = await import("https://esm.sh/@farcaster/frame-sdk");
    const sdk = mod?.default ?? mod;
    if (sdk?.wallet?.getEthereumProvider) {
      const p = await sdk.wallet.getEthereumProvider();
      if (p?.request) return p as Eip1193Provider;
    }
  } catch {}

  // 3) Last resort: injected providers (MetaMask etc.)
  const w = window as any;
  if (w.ethereum?.request) return w.ethereum as Eip1193Provider;

  return null;
}

export async function ensureBaseChain(provider: Eip1193Provider): Promise<string> {
  const chainId: string = await provider.request({ method: "eth_chainId" });
  if (chainId === "0x2105") return chainId;

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
    return "0x2105";
  } catch (err: any) {
    // Some wallets need addEthereumChain
    if (err?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x2105",
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          // Use the official Base RPC for addEthereumChain compatibility (no proxy here)
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"]
        }]
      });
      return "0x2105";
    }
    throw err;
  }
}

export async function requestAccounts(provider: Eip1193Provider): Promise<string> {
  const accts: string[] = await provider.request({ method: "eth_requestAccounts" });
  return accts?.[0] ?? "";
}
