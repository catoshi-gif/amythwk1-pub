/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brandAmethyst: "#541FF3",
        brandViolet: "#7C3AEE",
        brandLavender: "#C2B6F7",
        brandMint: "#1BFDB2",
        brandBackground: "#191919",
        brandCharcoal: "#FBF8FA",
        brandSurface: "#221D2B",
        brandSurfaceSoft: "#2A2336",
        brandStroke: "#332B41",
        brandMuted: "#AAA0C7",
        brandSoft: "#DED8EF",
        amyth: {
          50: "#0F0D13",
          100: "#FBF8FA",
          200: "#E8E0F7",
          300: "#C2B6F7",
          400: "#9D84F1",
          500: "#7C3AEE",
          600: "#541FF3",
          700: "#403457",
          800: "#302742",
          900: "#1C1725",
          950: "#110E16",
        },
        crystal: {
          glow: "#C2B6F7",
          frost: "#FBF8FA",
          deep: "#1E1927",
          abyss: "#15121D",
          surface: "#221D2B",
        },
        brandBlack: "#191919",
        brandWhite: "#FBF8FA",
      },
      backgroundImage: {
        "amyth-gradient": "linear-gradient(90deg, #541FF3 0%, #1BFDB2 100%)",
        "amyth-radial":
          "radial-gradient(ellipse at top, rgba(84,31,243,0.24) 0%, rgba(124,58,238,0.10) 34%, rgba(27,253,178,0.08) 62%, transparent 78%)",
      },
      fontFamily: {
        display: ["var(--font-sora)", "system-ui", "sans-serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        crystal: "0 22px 60px -28px rgba(84,31,243,0.38)",
        "crystal-sm": "0 12px 30px -18px rgba(84,31,243,0.32)",
        "crystal-lg": "0 32px 80px -34px rgba(84,31,243,0.45)",
        glow: "0 0 40px -18px rgba(124,58,238,0.42)",
      },
      animation: {
        "facet-shimmer": "facetShimmer 6s ease-in-out infinite",
        "crystal-pulse": "crystalPulse 4s ease-in-out infinite",
        float: "float 6s ease-in-out infinite",
      },
      keyframes: {
        facetShimmer: {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "0.75" },
        },
        crystalPulse: {
          "0%, 100%": { boxShadow: "0 0 36px -16px rgba(84,31,243,0.18)" },
          "50%": { boxShadow: "0 0 60px -16px rgba(84,31,243,0.34)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
    },
  },
  plugins: [],
};
