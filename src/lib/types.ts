export type TxStatus = "pending" | "confirmed" | "failed";

export type ChatMessage = {
  id: string;               // txHash:logIndex OR local:<callId>
  createdAtMs: number;
  from: string;             // address
  name?: string;            // optional display name
  text: string;
  status: TxStatus;
  txHash?: string;
  logIndex?: number;
  error?: string;
};
