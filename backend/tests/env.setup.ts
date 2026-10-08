// config.ts validates and parses process.env at import time — every test
// file that (transitively) imports it needs these set first.
process.env.PORT ??= "4000";
process.env.HORIZON_URL ??= "https://horizon-testnet.stellar.org";
process.env.NETWORK_PASSPHRASE ??= "Test SDF Network ; September 2015";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_SECRET ??= "test-jwt-secret";
process.env.API_KEY ??= "test-api-key";
process.env.LOCK_BACKEND ??= "in-process";
process.env.SOROBAN_RPC_URL ??= "https://soroban-testnet.stellar.org";
process.env.SOROBAN_NETWORK_PASSPHRASE ??= "Test SDF Network ; September 2015";
// Real globe-wallet contract deployed to testnet while validating this PR
// (see PR description) — used as a stable fixture for tests that need
// *some* well-formed contract ID but mock all network calls.
process.env.GLOBE_WALLET_CONTRACT_ID ??=
  "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K";
