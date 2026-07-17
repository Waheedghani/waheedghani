import type { Config } from "tailwindcss";

/**
 * SARAI ERP design tokens — dense corporate ERP look (NetSuite / Dynamics style).
 * Base font 13px, neutral grays, one navy header + one accent for primary actions.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // dark corporate header
        header: {
          DEFAULT: "#1B2A4A",
          hover: "#24365C",
          active: "#2E4370",
          text: "#E8ECF4",
        },
        accent: {
          DEFAULT: "#1F5CB4",
          hover: "#17498F",
          soft: "#E8F0FB",
        },
        surface: {
          DEFAULT: "#F5F6F8",
          panel: "#FFFFFF",
          sunken: "#EDEFF2",
        },
        line: {
          DEFAULT: "#D0D5DD",
          soft: "#E4E7EC",
          strong: "#98A2B3",
        },
        ink: {
          DEFAULT: "#1D2433",
          soft: "#475467",
          faint: "#667085",
        },
        status: {
          draft: "#667085",
          posted: "#067647",
          postedBg: "#ECFDF3",
          partial: "#B54708",
          partialBg: "#FFFAEB",
          reversed: "#B42318",
          reversedBg: "#FEF3F2",
          closed: "#175CD3",
          closedBg: "#EFF4FF",
        },
      },
      fontSize: {
        // ERP density: 13px base
        base: ["13px", "1.45"],
        sm: ["12px", "1.4"],
        xs: ["11px", "1.35"],
        lg: ["14px", "1.45"],
        xl: ["16px", "1.4"],
        "2xl": ["19px", "1.35"],
      },
      fontFamily: {
        sans: ["Segoe UI", "system-ui", "-apple-system", "Arial", "sans-serif"],
        // Pashto / RTL stack
        pashto: ["Noto Naskh Arabic", "Bahij Nassim", "Lateef", "Tahoma", "serif"],
        mono: ["Consolas", "ui-monospace", "monospace"],
      },
      spacing: {
        "row": "32px",
      },
    },
  },
  plugins: [],
};
export default config;
