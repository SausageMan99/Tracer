import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        trailforge: {
          "bg-deep":     "#080C0A",
          "bg-surface":  "#0D1410",
          "bg-elevated": "#141C17",
          border:        "#1E2B22",
          "text-primary":"#E8EDE9",
          "text-muted":  "#5C7363",
          "accent-moss": "#4A7C59",
          "accent-sage": "#7FB08A",
          "accent-lime": "#A8D672",
          "accent-amber":"#D4A843",
          "accent-trail":"#C17A3A",
        },
      },
      fontFamily: {
        playfair: ["var(--font-playfair)", "Georgia", "serif"],
        syne:     ["var(--font-syne)", "sans-serif"],
        inter:    ["var(--font-inter)", "sans-serif"],
        mono:     ["var(--font-jetbrains)", "monospace"],
      },
      animation: {
        "pulse-ring": "pulse-ring 2s cubic-bezier(0.16,1,0.3,1) infinite",
      },
      keyframes: {
        "pulse-ring": {
          "0%":   { transform: "scale(0.8)", opacity: "1" },
          "100%": { transform: "scale(2)",   opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
