import { rpcCall } from "./contract";

/**
 * Preflight check: does this connected address have Base ETH?
 * Many wallets show "not enough funds" for any bundling failure.
 * This helps detect the genuinely-empty-balance case early.
 */
export async function hasBaseEth(address: `0x${string}`) {
  try {
    const bal = (await rpcCall("eth_getBalance", [address, "latest"])) as `0x${string}`;
    // Treat < 0.00001 ETH as effectively empty
    const n = BigInt(bal);
    return n > 10_000_000_000_000n; // 1e13 wei
  } catch {
    // If RPC fails, don't block user; just return true so flow continues
    return true;
  }
}
