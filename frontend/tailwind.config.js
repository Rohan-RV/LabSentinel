/** @type {import('tailwindcss').Config} */
const v = (n) => `rgb(var(--c-${n}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // surfaces and borders (flip with theme)
        ink: { 900: v("ink-900"), 800: v("ink-800"), 700: v("ink-700"), 600: v("ink-600"), 500: v("ink-500") },
        // text scale (inverted between themes)
        slate: { 100: v("slate-100"), 200: v("slate-200"), 300: v("slate-300"), 400: v("slate-400"), 500: v("slate-500") },
        // accent text shades that need to darken in light mode (400/500 keep Tailwind defaults)
        cyan: { 200: v("cyan-200"), 300: v("cyan-300") },
        emerald: { 300: v("emerald-300") },
        violet: { 300: v("violet-300") },
        amber: { 300: v("amber-300"), 400: v("amber-400") },
        orange: { 300: v("orange-300") },
        // status colors stay constant across themes
        healthy: "#22c55e",
        warning: "#f59e0b",
        critical: "#ef4444",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
