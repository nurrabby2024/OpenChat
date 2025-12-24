import { Eip1193Provider } from "./wallet";

export const CHAT_CONTRACT = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
export const BASE_CHAIN_ID = "0x2105";

// Builder Code (Base Builder Codes)
export const BUILDER_CODE = "bc_rlbxoel7";

export type ContractShape = {
  abi: any[];
  sendFnName: string;
  argType: "string" | "bytes";
  methodCall?: string;
};

const SHAPE_URL = "/api/shape";

const SHAPE_URL = "/api/shape";

export async function fetchContractShape(from: string): Promise<ContractShape> {
  if (!from || !from.startsWith("0x") || from.length < 10) {
    throw new Error("FROM_REQUIRED");
  }

  const res = await fetch(SHAPE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ from }),
    cache: "no-store",
  });

  const json: any = await res.json().catch(() => null);

  if (!json || json.status !== "1" || !json.result?.abi || !json.result?.sendFnName) {
    const msg = json?.message || "SHAPE_UNAVAILABLE";
    const detail = json?.result?.methodCall ? ` (${json.result.methodCall})` : "";
    throw new Error(`${msg}${detail}`);
  }

  const abi = JSON.parse(json.result.abi);
  if (!Array.isArray(abi)) throw new Error("INVALID_SHAPE_ABI");

  return {
    abi,
    sendFnName: String(json.result.sendFnName),
    argType: json.result.argType === "bytes" ? "bytes" : "string",
    methodCall: json.result.methodCall ? String(json.result.methodCall) : undefined,
  };
}


export async function buildDataSuffix(): Promise<string> {
  const { Attribution } = await import("https://esm.sh/ox/erc8021");
  const dataSuffix = Attribution.toDataSuffix({
    codes: [BUILDER_CODE],
  });
  return dataSuffix as string;
}

export async function encodeSendData(shape: ContractShape, message: string): Promise<string> {
  const viem = await import("https://esm.sh/viem");
  const { encodeFunctionData } = viem as any;
  return encodeFunctionData({
    abi: shape.abi,
    functionName: shape.sendFnName,
    args: [message],
  });
}

export async function walletSendCalls(provider: Eip1193Provider, from: string, chainId: string, to: string, data: string, dataSuffix: string) {
  const payload = {
    version: "2.0.0",
    from,
    chainId,
    atomicRequired: true,
    calls: [{
      to,
      value: "0x0",
      data,
    }],
    capabilities: { dataSuffix },
  };

  return provider.request({ method: "wallet_sendCalls", params: [payload] });
}

export async function walletGetCallsStatus(provider: Eip1193Provider, callId: string) {
  return provider.request({ method: "wallet_getCallsStatus", params: [callId] });
}
