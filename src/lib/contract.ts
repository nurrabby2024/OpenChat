import { Eip1193Provider } from "./wallet";

export const CHAT_CONTRACT = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
export const BASE_CHAIN_ID = "0x2105";

// Builder Code (Base Builder Codes)
export const BUILDER_CODE = "bc_rlbxoel7";

export type ContractShape = {
  abi: any[];
  sendFnName: string;
  eventName: string;
};

const BLOCKSCOUT_ABI_URL = `https://base.blockscout.com/api?module=contract&action=getabi&address=${CHAT_CONTRACT}`;

export async function fetchAbi(): Promise<any[]> {
  const res = await fetch(BLOCKSCOUT_ABI_URL, { headers: { "accept": "application/json" } });
  const json: any = await res.json().catch(() => null);
  // Blockscout RPC-style: {status:"1", message:"OK", result:"[...abi...]"}
  const raw = json?.result;
  if (!raw || typeof raw !== "string") throw new Error("ABI unavailable from Blockscout");
  const abi = JSON.parse(raw);
  if (!Array.isArray(abi)) throw new Error("Invalid ABI format");
  return abi;
}

function scoreSendFn(name: string) {
  const n = (name || "").toLowerCase();
  const hits = ["message","chat","post","write","send","say","speak","bitchat","publish","shout"];
  let s = 0;
  for (const h of hits) if (n.includes(h)) s += 5;
  return s;
}

function scoreEvent(name: string) {
  const n = (name || "").toLowerCase();
  const hits = ["message","chat","post","write","send","say","speak","bitchat","publish"];
  let s = 0;
  for (const h of hits) if (n.includes(h)) s += 4;
  return s;
}

export function inferContractShape(abi: any[]): ContractShape {
  const fns = abi.filter((x) => x?.type === "function" && x?.stateMutability !== "view" && x?.stateMutability !== "pure");
  const stringFns = fns
    .map((f: any) => ({ f, inputs: (f?.inputs ?? []) as any[] }))
    .filter(({ inputs }) => inputs.length === 1 && (inputs[0]?.type === "string" || inputs[0]?.type === "bytes"));

  if (stringFns.length === 0) {
    throw new Error("No suitable write function found (expected 1 string/bytes input)");
  }

  stringFns.sort((a, b) => scoreSendFn(b.f.name) - scoreSendFn(a.f.name));
  const sendFnName = stringFns[0].f.name;

  const events = abi.filter((x) => x?.type === "event");
  const msgEvents = events.filter((e: any) => (e?.inputs ?? []).some((i: any) => i?.type === "string" || i?.type === "bytes"));
  if (msgEvents.length === 0) {
    throw new Error("No suitable message event found (expected event with string/bytes)");
  }
  msgEvents.sort((a: any, b: any) => scoreEvent(b.name) - scoreEvent(a.name));
  const eventName = msgEvents[0].name;

  return { abi, sendFnName, eventName };
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

export async function decodeLogs(shape: ContractShape, logs: any[]): Promise<Array<{ from: string; text: string; txHash: string; logIndex: number }>> {
  const viem = await import("https://esm.sh/viem");
  const { decodeEventLog } = viem as any;
  const out: Array<{ from: string; text: string; txHash: string; logIndex: number }> = [];

  for (const l of logs) {
    try {
      const decoded = decodeEventLog({
        abi: shape.abi,
        data: l.data,
        topics: l.topics,
      });
      if (decoded?.eventName !== shape.eventName) continue;
      const args = decoded.args ?? {};
      // Try common keys
      const from = (args.from || args.sender || args.author || args.user || args._from || args[0] || "").toString();
      const text = (args.message || args.text || args.content || args.body || args._message || args[1] || "").toString();
      if (!from || !text) continue;
      out.push({ from, text, txHash: l.transactionHash, logIndex: parseInt(l.logIndex, 16) });
    } catch {
      // ignore non-matching logs
    }
  }
  return out;
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
