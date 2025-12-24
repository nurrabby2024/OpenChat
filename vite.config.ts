import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const REMOTE_EXTERNAL = [
  "https://esm.sh/ox/erc8021",
  "https://esm.sh/@farcaster/frame-sdk",
  "https://esm.sh/viem",
  "https://esm.sh/viem/chains"
];

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    rollupOptions: {
      external: (id) => REMOTE_EXTERNAL.includes(id) || id.startsWith("https://esm.sh/"),
    },
  },
});
