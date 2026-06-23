import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        numa: {
          50: "#faf8f5",
          100: "#f0ebe3",
          200: "#e0d5c5",
          500: "#a8967e",
          600: "#8a7660",
          700: "#6b5a48",
          900: "#3d332a",
        },
      },
    },
  },
  plugins: [],
};

export default config;
