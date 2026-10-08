// Only used by Jest, to transpile the ESM-only @noble/* packages that
// @stellar/stellar-sdk@16 depends on (they ship no CommonJS build) into
// something Jest's CJS-based test runner can `require()`. Production code
// runs via `tsc`/`tsx`, which handle this natively — this file is never
// part of the build output.
module.exports = {
  presets: [["@babel/preset-env", { targets: { node: "current" } }]],
};
