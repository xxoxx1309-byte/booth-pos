/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1c30",
        muted: "#667085",
        primary: "#3858b7",
        secondary: "#6554c0",
        canvas: "#f8f9ff",
        panel: "#ffffff",
        soft: "#eff4ff",
        line: "#dce3ef",
        danger: "#ba1a1a",
      },
      fontFamily: {
        sans: ["Manrope", "Pretendard", "Apple SD Gothic Neo", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        serif: ["DM Serif Display", "Georgia", "serif"],
      },
      boxShadow: {
        glow: "0 10px 35px rgba(56, 88, 183, 0.12)",
        card: "0 4px 20px rgba(64, 89, 135, 0.08)",
      },
    },
  },
  plugins: [],
};
