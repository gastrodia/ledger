// Polyfill for older Node versions that don't provide global structuredClone.
// eslint-config-next (and eslint internals) may call structuredClone while building config.
if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

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
]);

export default eslintConfig;
