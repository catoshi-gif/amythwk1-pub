export const AMYTH_THEME = {
  colors: {
    amethyst: "#541FF3",
    violet: "#7C3AEE",
    lavender: "#C2B6F7",
    mint: "#1BFDB2",
    background: "#191919",
    charcoal: "#FBF8FA",
    white: "#FBF8FA",
    surface: "#221D2B",
    surfaceSoft: "#2A2336",
    stroke: "#332B41",
    textMuted: "#AAA0C7",
    textSoft: "#DED8EF",
  },
  fonts: {
    heading: "Sora",
    body: "Inter",
  },
  gradients: {
    primary: "linear-gradient(90deg, #541FF3 0%, #1BFDB2 100%)",
    heroGlow:
      "radial-gradient(ellipse at top, rgba(84, 31, 243, 0.24) 0%, rgba(124, 58, 238, 0.10) 34%, rgba(27, 253, 178, 0.08) 62%, transparent 78%)",
    text: "linear-gradient(90deg, #C2B6F7 0%, #7C3AEE 54%, #1BFDB2 100%)",
  },
  shadows: {
    sm: "0 12px 30px -18px rgba(84, 31, 243, 0.32)",
    md: "0 22px 60px -28px rgba(84, 31, 243, 0.38)",
    glow: "0 0 40px -18px rgba(124, 58, 238, 0.42)",
  },
} as const;

export type AmythTheme = typeof AMYTH_THEME;
