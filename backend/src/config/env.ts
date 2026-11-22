import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: optionalInt('PORT', 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  stellarNetwork: optional('STELLAR_NETWORK', 'testnet'),
  horizonUrl: optional('HORIZON_URL', 'https://horizon-testnet.stellar.org'),
  sorobanRpcUrl: optional('SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org'),
  contractId: required('CONTRACT_ID'),
  recovery: {
    // SEP-30 recovery server integration (alternative/complement to guardians).
    sep30Enabled: optionalBool('SEP30_ENABLED', false),
    sep30ServerUrl: optional('SEP30_SERVER_URL', ''),
    sep30AuthToken: optional('SEP30_AUTH_TOKEN', ''),
    sep30IdentityRequired: optionalBool('SEP30_IDENTITY_REQUIRED', true),
    sep30RequestTimeoutMs: optionalInt('SEP30_REQUEST_TIMEOUT_MS', 10000),
  },
};

export type Env = typeof env;
