import { Eip1193Provider } from "./wallet";
//ok
export const CHAT_CONTRACT = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
export const BASE_CHAIN_ID = "0x2105";

// Builder Code (Base Builder Codes)
export const BUILDER_CODE = "bc_rlbxoel7";

export type ContractShape = {
  selector: `0x${string}`;          // 4-byte selector, e.g. 0x12345678
  argType: "string" | "bytes";      // dynamic arg type (encoding same style)
};

const SHAPE_URL = "/api/shape";

export async function fetchContractShape(from: string): Promise<ContractShape> {
  if (!from || !from.startsWith("0x")) throw new Error("FROM_REQUIRED");

  const res = await fetch(SHAPE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ from }),
    cache: "no-store",
  });

  const json: any = await res.json().catch(() => null);

  if (!json || json.status !== "1" || !json.result?.selector) {
    throw new Error(json?.message || "SHAPE_UNAVAILABLE");
  }

  const selector = String(json.result.selector);
  if (!selector.startsWith("0x") || selector.length !== 10) {
    throw new Error("INVALID_SELECTOR");
  }

  return {
    selector: selector as `0x${string}`,
    argType: json.result.argType === "bytes" ? "bytes" : "string",
  };
}

export async function buildDataSuffix(): Promise<string> {
  const { Attribution } = await import("https://esm.sh/ox/erc8021");
  const dataSuffix = Attribution.toDataSuffix({
    codes: [BUILDER_CODE],
  });
  return dataSuffix as string;
}

// When we can't rely on ERC-5792 capabilities (wallet_sendCalls), we can manually append
// the ERC-8021 attribution suffix to calldata.
export function appendDataSuffix(data: string, dataSuffix: string): string {
  if (!dataSuffix) return data;
  const d = String(data || "");
  const s = String(dataSuffix || "");
  if (!d.startsWith("0x")) return data;
  if (!s.startsWith("0x")) return data;
  return (d + s.slice(2)) as string;
}

function pad32(hexNo0x: string) {
  return hexNo0x.padStart(64, "0");
}

function utf8ToHex(s: string) {
  const bytes = new TextEncoder().encode(s);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ABI encoding for single dynamic param (string or bytes):
// head: offset(0x20)
// tail: length + data padded
function encodeSingleDynamic(message: string) {
  const headOffset = pad32("20");
  const dataHex = utf8ToHex(message);
  const lenBytes = dataHex.length / 2;
  const lenWord = pad32(lenBytes.toString(16));
  const padded = dataHex.padEnd(Math.ceil(dataHex.length / 64) * 64, "0");
  return headOffset + lenWord + padded;
}

export async function encodeSendData(shape: ContractShape, message: string): Promise<string> {
  const tail = encodeSingleDynamic(message);
  return (shape.selector + tail) as string;
}

export async function walletSendCalls(
  provider: Eip1193Provider,
  from: string,
  chainId: string,
  to: string,
  data: string,
  dataSuffix: string
) {
  const payload = {
    version: "2.0.0",
    from,
    chainId,
    atomicRequired: true,
    calls: [
      {
        to,
        value: "0x0",
        data,
      },
    ],
    capabilities: { dataSuffix },
  };

  return provider.request({ method: "wallet_sendCalls", params: [payload] });
}

/**
 * Some wallets (including certain Farcaster/Base Mini App containers) have flaky support for
 * ERC-5792 capabilities. If they can't build a bundle, they often show a misleading
 * "make sure you have enough funds" error.
 *
 * Best-effort strategy:
 *  1) Try wallet_sendCalls using the dataSuffix capability (wallet appends suffix)
 *  2) If that fails, try wallet_sendCalls WITHOUT capabilities, but with the suffix appended
 *     directly to calldata (still preserves Builder Code attribution)
 */
export async function walletSendCallsBestEffort(
  provider: Eip1193Provider,
  from: string,
  chainId: string,
  to: string,
  data: string,
  dataSuffix: string
) {
  // 1) Normal path (capability)
  try {
    return await walletSendCalls(provider, from, chainId, to, data, dataSuffix);
  } catch (e: any) {
    const msg = String(e?.message || "");
    const code = e?.code;
    const looksLikeBuildOrCapabilityIssue =
      code === -32000 ||
      /insufficient funds/i.test(msg) ||
      /error generating transaction/i.test(msg) ||
      /funds/i.test(msg) ||
      /gas/i.test(msg) ||
      /capabilit/i.test(msg);

    if (!looksLikeBuildOrCapabilityIssue) throw e;
  }

  // 2) Fallback: append suffix to calldata and omit capabilities entirely.
  // This avoids any wallet capability handling, while keeping attribution.
  const dataWithSuffix = appendDataSuffix(data, dataSuffix);
  const payload = {
    version: "2.0.0",
    from,
    chainId,
    atomicRequired: true,
    calls: [
      {
        to,
        value: "0x0",
        data: dataWithSuffix,
      },
    ],
  };
  return provider.request({ method: "wallet_sendCalls", params: [payload] });
}

export async function walletGetCallsStatus(provider: Eip1193Provider, callId: string) {
  return provider.request({ method: "wallet_getCallsStatus", params: [callId] });
}
