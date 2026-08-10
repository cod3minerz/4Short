import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: [
      "app/dashboard/**/*.{js,jsx,ts,tsx}",
      "app/admin/**/*.{js,jsx,ts,tsx}",
      "app/sign-in/**/*.{js,jsx,ts,tsx}",
      "app/sign-up/**/*.{js,jsx,ts,tsx}",
      "app/forgot-password/**/*.{js,jsx,ts,tsx}",
      "components/hashpix/**/*.{js,jsx,ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "lucide-react", message: "Product UI uses Hugeicons via AppIcon." },
          { name: "@/components/hashpix/action-button", message: "Use AsyncButton or IconButton." },
          { name: "@/components/hashpix/field", message: "Use registry Field." },
          { name: "@/components/hashpix/info-panel", message: "Use registry Card or inline status." },
        ],
        patterns: [
          { group: ["@heroui/*"], message: "HeroUI is public-boundary only." },
          { group: ["@/components/legacy/*", "@/docs/archive/*", "@/docs/migrations/archive/*"], message: "Archived UI is historical and cannot be imported." },
          { group: ["@base-ui/react", "@radix-ui/*"], message: "Product code uses registry primitives from components/ui, not direct alternative anatomy." },
        ],
      }],
    },
  },
]);

export default eslintConfig;
