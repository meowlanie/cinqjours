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
    // Reference prototype (not part of the running app).
    "prototype/**",
  ]),
  {
    // French UI text is full of apostrophes — they are fine in JSX text nodes.
    rules: {
      "react/no-unescaped-entities": ["error", { forbid: [">"] }],
    },
  },
]);

export default eslintConfig;
