import { Eip1193Provider } from "./wallet";

export const CHAT_CONTRACT = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
export const BASE_CHAIN_ID = "0x2105";

// Builder Code
export const BUILDER_CODE = "bc_rlbxoel7";

export type ContractShape = {
  methodId: `0x${string}`;      // 0x + 8 hex
  methodCall?: string;          // e.g. "sendMessage(string message)"
  fnName: string;               // parsed
  inputTypes: string[];         // parsed types
};

const SHAPE_URL = "/api/shape";

export async function fetchContractShape(from: string): Promise<ContractShape> {
  const res = await fetch(SHAPE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ from }),
    cache: "no-store",
  });

  const json: any = await res.json().catch(() => null);
  if (!json || json.status !== "1" || !json.result?.methodId) {
    throw new Error(json?.message || "SHAPE_UNAVAILABLE");
  }

  const methodId = String(json.result.methodId);
  const methodCall = String(json.result.methodCall || "");
  const parsed = parseMethodCall(methodCall);

  return {
    methodId: methodId as `0x${string}`,
    methodCall,
    fnName: parsed.fnName,
    inputTypes: parsed.inputTypes,
  };
}

function parseMethodCall(methodCall: string): { fnName: string; inputTypes: string[] } {
  // Examples from Blockscout: "transferFrom(address _from, address _to, uint256 _value)" :contentReference[oaicite:5]{index=5}
  // We only need types list.
  const s = (methodCall || "").trim();
  const open = s.indexOf("(");
  const close = s.lastIndexOf(")");
  if (open <= 0 || close <= open) {
    // fallback: unknown signature; assume single string
    return { fnName: "unknown", inputTypes: ["string"] };
  }

  const fnName = s.slice(0, open).trim() || "unknown";
  const inside = s.slice(open + 1, close).trim();
  if (!inside) return { fnName, inputTypes: [] };

  const parts = inside.split(",").map((p) => p.trim()).filter(Boolean);
  // "string message" -> "string"
  const inputTypes = parts.map((p) => p.split(/\s+/)[0]).filter(Boolean);

  return { fnName, inputTypes };
}

export async function buildDataSuffix(): Promise<string> {
  const { Attribution } = await import("https://esm.sh/ox/erc8021");
  return Attribution.toDataSuffix({ codes: [BUILDER_CODE] }) as string;
}

export async function encodeSendData(shape: ContractShape, message: string): Promise<string> {
  const viem = await import("https://esm.sh/viem");
  const { encodeFunctionData } = viem as any;

  // We ONLY support a single dynamic string/bytes input for chat message.
  // If contract uses different signature, we must update mapping.
  if (shape.inputTypes.length !== 1) {
    throw new Error("UNSUPPORTED_SIGNATURE");
  }

  const t = shape.inputTypes[0];
  if (t !== "string" && t !== "bytes") {
    throw new Error("UNSUPPORTED_ARG_TYPE");
  }

  const abi = [{
    type: "function",
    name: shape.fnName,
    stateMutability: "nonpayable",
    inputs: [{ name: "message", type: t }],
    outputs: [],
  }];

  return encodeFunctionData({
    abi,
    functionName: shape.fnName,
    args: [t === "bytes" ? (new TextEncoder().encode(message)) : message],
  });
}

export async function walletSendCalls(provider: Eip1193Provider, from: string, chainId: string, to: string, data: string, dataSuffix: string) {
  const payload = {
    version: "2.0.0",
    from,
    chainId,
    atomicRequired: true,
    calls: [{ to, value: "0x0", data }],
    capabilities: { dataSuffix },
  };
  return provider.request({ method: "wallet_sendCalls", params: [payload] });
}

export async function walletGetCallsStatus(provider: Eip1193Provider, callId: string) {
  return provider.request({ method: "wallet_getCallsStatus", params: [callId] });
}
