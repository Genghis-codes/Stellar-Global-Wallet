/**
 * Minimal ESLint config for the backend (`npm run lint`). ESLint 8 with the
 * legacy config format, matching the eslint@8 / @typescript-eslint@8 devDeps.
 * Rules focus on real defects rather than style.
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { node: true, es2022: true, jest: true },
  ignorePatterns: ["dist/", "node_modules/", "coverage/"],
  rules: {
    "no-constant-condition": ["error", { checkLoops: false }],
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
    ],
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-require-imports": "off",
  },
};
