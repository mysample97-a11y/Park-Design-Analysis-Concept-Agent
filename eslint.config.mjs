// Audit-only config: finds unused identifiers and undefined references, which is
// exactly the class of defect that hid Tesseract, provenance and retryAfterSeconds.
import js from "@eslint/js";
import react from "eslint-plugin-react";
export default [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly", document: "readonly", localStorage: "readonly",
        navigator: "readonly", console: "readonly", fetch: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
        clearInterval: "readonly", Blob: "readonly", URL: "readonly",
        FileReader: "readonly", Image: "readonly", atob: "readonly", btoa: "readonly",
        alert: "readonly", TextDecoder: "readonly", performance: "readonly",
        requestAnimationFrame: "readonly", ResizeObserver: "readonly",
        HTMLElement: "readonly", Event: "readonly", process: "readonly",
      },
    },
    plugins: { react },
    settings: { react: { version: "detect" } },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
    },
  },
];
