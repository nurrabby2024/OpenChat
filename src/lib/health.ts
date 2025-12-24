const RPCS = ["/api/rpc"];

export type RpcHealth = { status: "green" | "yellow" | "red"; rpc: string; blockNumber?: number; ms?: number; note?: string };

async function rpcCall(rpc: string, method: string, params: any[] = []) {
  const t0 = performance.now();
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const json = await res.json();
  const ms = Math.round(performance.now() - t0);
  if (json.error) throw Object.assign(new Error(json.error.message || "RPC error"), { ms });
  return { result: json.result, ms };
}

export async function pickHealthyRpc(): Promise<RpcHealth> {
  for (const rpc of RPCS) {
    try {
      const { result, ms } = await rpcCall(rpc, "eth_blockNumber");
      const blockNumber = parseInt(result, 16);
      const status: RpcHealth["status"] = ms < 900 ? "green" : ms < 2200 ? "yellow" : "yellow";
      return { status, rpc, blockNumber, ms };
    } catch (e: any) {
      // try next
    }
  }
  return { status: "red", rpc: RPCS[0], note: "RPC unreachable" };
}

export async function rpcBlockNumber(rpc: string) {
  const { result } = await rpcCall(rpc, "eth_blockNumber");
  return parseInt(result, 16);
}

export async function rpcGetLogs(rpc: string, filter: any) {
  const { result } = await rpcCall(rpc, "eth_getLogs", [filter]);
  return result as any[];
}

export async function rpcGetTransactionReceipt(rpc: string, txHash: string) {
  const { result } = await rpcCall(rpc, "eth_getTransactionReceipt", [txHash]);
  return result as any;
}

export async function rpcGetBalance(rpc: string, address: string) {
  const { result } = await rpcCall(rpc, "eth_getBalance", [address, "latest"]);
  return result as string; // hex wei
}
