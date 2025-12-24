import { getRpcUrl } from "./rpc";

export function appendDataSuffix(data: `0x${string}`, dataSuffix?: `0x${string}`) {
  if (!dataSuffix) return data;
  if (dataSuffix === "0x") return data;
  // append without double 0x
  return (data + dataSuffix.slice(2)) as `0x${string}`;
}

/**
 * Minimal helper to build calldata for: 0x<selector><abi-encoded args>
 * Current project uses selector + abi-encoded (string) argument.
 */
export function buildCalldata(selector: `0x${string}`, encodedArgs: `0x${string}`) {
  // selector is 4 bytes (8 hex chars) + 0x = 10 length
  // encodedArgs already has 0x prefix; drop it and append
  return (selector + encodedArgs.slice(2)) as `0x${string}`;
}

type SendCallsArgs = {
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: `0x${string}`;
  dataSuffix?: `0x${string}`;
};

/**
 * Try wallet_sendCalls in 2 modes:
 * 1) With capabilities.dataSuffix (preferred when wallet supports)
 * 2) If that fails, retry WITHOUT capabilities but with dataSuffix manually appended
 *
 * This is aimed at wallets that show "Error generating transaction" when handling dataSuffix capability.
 */
export async function sendCallsWithFallback(ethereum: any, args: SendCallsArgs) {
  const call = {
    from: args.from,
    to: args.to,
    data: args.data,
    value: args.value ?? "0x0",
  };

  // Mode-1: sendCalls with capabilities (dataSuffix)
  try {
    const res = await ethereum.request({
      method: "wallet_sendCalls",
      params: [
        {
          calls: [call],
          capabilities: args.dataSuffix
            ? {
                dataSuffix: args.dataSuffix,
              }
            : undefined,
        },
      ],
    });
    return { ok: true as const, res, mode: "sendCalls-capabilities" as const };
  } catch (e: any) {
    // Mode-2: retry without capabilities but with manual suffix appended
    try {
      const data2 = appendDataSuffix(args.data, args.dataSuffix);
      const res2 = await ethereum.request({
        method: "wallet_sendCalls",
        params: [
          {
            calls: [
              {
                ...call,
                data: data2,
              },
            ],
          },
        ],
      });
      return { ok: true as const, res: res2, mode: "sendCalls-manualSuffix" as const };
    } catch (e2: any) {
      return { ok: false as const, error: e2 ?? e, mode: "sendCalls-failed" as const };
    }
  }
}

export async function sendTransactionFallback(
  ethereum: any,
  args: SendCallsArgs
): Promise<{ ok: true; res: any; mode: "sendTransaction" } | { ok: false; error: any; mode: "sendTransaction-failed" }> {
  try {
    const data2 = appendDataSuffix(args.data, args.dataSuffix);
    const res = await ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: args.from,
          to: args.to,
          data: data2,
          value: args.value ?? "0x0",
        },
      ],
    });
    return { ok: true, res, mode: "sendTransaction" };
  } catch (e: any) {
    return { ok: false, error: e, mode: "sendTransaction-failed" };
  }
}

export async function rpcCall(method: string, params: any[] = []) {
  const rpc = getRpcUrl();
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j?.error) throw new Error(j.error?.message || "RPC error");
  return j?.result;
}
