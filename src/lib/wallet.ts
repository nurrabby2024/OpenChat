export type Eip1193Provider = {
  request: (args: { method: string; params?: any[] | object }) => Promise<any>;
};

export async function getProvider(): Promise<Eip1193Provider | null> {
  const w = window as any;
  if (w.ethereum?.request) return w.ethereum as Eip1193Provider;

  // Some Farcaster containers expose provider via frame sdk
  try {
    const mod: any = await import("https://esm.sh/@farcaster/frame-sdk");
    const sdk = mod?.default ?? mod;
    if (sdk?.wallet?.getEthereumProvider) {
      const p = await sdk.wallet.getEthereumProvider();
      if (p?.request) return p as Eip1193Provider;
    }
  } catch {}
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
