module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["ui-monospace","SFMono-Regular","Menlo","Monaco","Consolas","Liberation Mono","Courier New","monospace"] },
      colors: {
        bg: "#05080a",
        panel: "rgba(255,255,255,0.03)",
        line: "rgba(255,255,255,0.07)",
        text: "rgba(238,255,248,0.92)",
        muted: "rgba(238,255,248,0.65)",
        accent: "#7dffcf",
        warn: "#ffbf47",
        err: "#ff5468",
        ok: "#43f59c",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(125,255,207,0.20), 0 0 24px rgba(125,255,207,0.10)",
      }
    },
  },
  plugins: [],
};
