/*
 * ESLint — flat config. ONE job: catch undefined identifiers.
 *
 * The build cannot see them. `opts is not defined` shipped inside a provider
 * function because `opts` exists only in callAI: valid syntax, resolvable
 * modules, clean build, and a crash the moment the function ran. Same class as
 * the missing ToolErrorBoundary and setActiveBusy imports.
 *
 * Deliberately NOT a style config. Style rules produce hundreds of warnings that
 * bury the one finding that matters, and a linter people ignore is worse than
 * none. Every rule here is a correctness rule.
 */
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "harness_out/**", "**/*.harness.mjs", "audit.mjs"] },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021, React: "readonly" },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, "react-hooks": hooks },
    settings: { react: { version: "detect" } },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-const-assign": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      // Hook ORDER errors break a component outright, so they are errors.
      // exhaustive-deps is intentionally OFF: this codebase deliberately uses
      // [] -deps registration effects with live refs, and flagging every one
      // would bury the findings that matter.
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
