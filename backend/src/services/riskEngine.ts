import crypto from 'crypto';

/**
 * Outgoing payment risk engine.
 *
 * Computes privacy-preserving risk signals for a requested transaction build:
 * new device, new destination, velocity, unusual amount, and recent
 * recovery/limit changes. Identifiers are hashed (pseudonymized) before being
 * stored or compared so raw addresses/device ids never leave the process.
 */

export type RiskSignal =
  | 'new_device'
  | 'new_destination'
  | 'velocity'
  | 'unusual_amount'
  | 'recent_recovery_or_limit_change';

export interface RiskReason {
  signal: RiskSignal;
  weight: number;
  detail: string;
}

export interface RiskAssessment {
  score: number; // 0..100
  level: 'low' | 'medium' | 'high';
  reasons: RiskReason[];
  stepUpRequired: boolean;
}

export interface RiskConfig {
  /** Score at/above which step-up confirmation is required. */
  stepUpThreshold: number;
  /** Max outgoing builds allowed within the velocity window. */
  velocityMaxCount: number;
  /** Velocity window in milliseconds. */
  velocityWindowMs: number;
  /** Amount (in stroops, as string) above which an amount is "unusual". */
  unusualAmountThreshold: string;
  /** How long a recovery/limit change keeps raising risk, in ms. */
  recoveryWindowMs: number;
}

const DEFAULT_CONFIG: RiskConfig = {
  stepUpThreshold: 60,
  velocityMaxCount: 5,
  velocityWindowMs: 10 * 60 * 1000,
  unusualAmountThreshold: '10000000000', // 1000 XLM in stroops
  recoveryWindowMs: 24 * 60 * 60 * 1000,
};

function loadConfig(): RiskConfig {
  const env = process.env;
  const num = (v: string | undefined, fallback: number): number => {
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    stepUpThreshold: num(env.RISK_STEP_UP_THRESHOLD, DEFAULT_CONFIG.stepUpThreshold),
    velocityMaxCount: num(env.RISK_VELOCITY_MAX_COUNT, DEFAULT_CONFIG.velocityMaxCount),
    velocityWindowMs: num(env.RISK_VELOCITY_WINDOW_MS, DEFAULT_CONFIG.velocityWindowMs),
    unusualAmountThreshold:
      env.RISK_UNUSUAL_AMOUNT_THRESHOLD || DEFAULT_CONFIG.unusualAmountThreshold,
    recoveryWindowMs: num(env.RISK_RECOVERY_WINDOW_MS, DEFAULT_CONFIG.recoveryWindowMs),
  };
}

/** Pseudonymize an identifier so stored risk data is not directly identifying. */
export function pseudonymize(value: string): string {
  const salt = process.env.RISK_HASH_SALT || 'stellar-wallet-risk';
  return crypto.createHmac('sha256', salt).update(value).digest('hex');
}

interface VelocityEntry {
  at: number;
}

interface AccountRiskState {
  knownDevices: Set<string>;
  knownDestinations: Set<string>;
  velocity: VelocityEntry[];
  lastRecoveryOrLimitChangeAt?: number;
}

// In-memory, pseudonymized state. Keys are hashed account identifiers.
const state = new Map<string, AccountRiskState>();

function getState(accountKey: string): AccountRiskState {
  let s = state.get(accountKey);
  if (!s) {
    s = { knownDevices: new Set(), knownDestinations: new Set(), velocity: [] };
    state.set(accountKey, s);
  }
  return s;
}

/** Record that a recovery or spending-limit change happened for an account. */
export function recordRecoveryOrLimitChange(account: string): void {
  const s = getState(pseudonymize(account));
  s.lastRecoveryOrLimitChangeAt = Date.now();
}

export interface RiskInput {
  account: string;
  deviceId?: string;
  destination: string;
  amount: string; // stroops as string
}

/**
 * Assess risk for an outgoing payment build. Does not mutate velocity history;
 * call {@link recordBuild} after a successful build to advance velocity state.
 */
export function assessRisk(input: RiskInput, config: RiskConfig = loadConfig()): RiskAssessment {
  const accountKey = pseudonymize(input.account);
  const s = getState(accountKey);
  const reasons: RiskReason[] = [];
  const now = Date.now();

  // New device
  if (input.deviceId) {
    const deviceKey = pseudonymize(input.deviceId);
    if (!s.knownDevices.has(deviceKey)) {
      reasons.push({ signal: 'new_device', weight: 25, detail: 'Unrecognized device' });
    }
  }

  // New destination
  const destKey = pseudonymize(input.destination);
  if (!s.knownDestinations.has(destKey)) {
    reasons.push({ signal: 'new_destination', weight: 20, detail: 'First payment to this destination' });
  }

  // Velocity
  const windowStart = now - config.velocityWindowMs;
  const recent = s.velocity.filter((e) => e.at >= windowStart);
  if (recent.length >= config.velocityMaxCount) {
    reasons.push({
      signal: 'velocity',
      weight: 30,
      detail: `${recent.length} builds in the last ${Math.round(config.velocityWindowMs / 60000)}m`,
    });
  }

  // Unusual amount
  try {
    const amount = BigInt(input.amount);
    const threshold = BigInt(config.unusualAmountThreshold);
    if (amount > threshold) {
      reasons.push({ signal: 'unusual_amount', weight: 15, detail: 'Amount above usual threshold' });
    }
  } catch {
    // Invalid amount is validated at the edge; ignore here.
  }

  // Recent recovery / limit change
  if (
    s.lastRecoveryOrLimitChangeAt !== undefined &&
    now - s.lastRecoveryOrLimitChangeAt <= config.recoveryWindowMs
  ) {
    reasons.push({
      signal: 'recent_recovery_or_limit_change',
      weight: 20,
      detail: 'Recent recovery or limit change',
    });
  }

  const score = Math.min(100, reasons.reduce((sum, r) => sum + r.weight, 0));
  const level: RiskAssessment['level'] = score >= config.stepUpThreshold ? 'high' : score >= 30 ? 'medium' : 'low';

  return {
    score,
    level,
    reasons,
    stepUpRequired: score >= config.stepUpThreshold,
  };
}

/** Advance velocity/known-entity state after a build is issued. */
export function recordBuild(input: RiskInput, config: RiskConfig = loadConfig()): void {
  const s = getState(pseudonymize(input.account));
  const now = Date.now();
  if (input.deviceId) s.knownDevices.add(pseudonymize(input.deviceId));
  s.knownDestinations.add(pseudonymize(input.destination));
  s.velocity.push({ at: now });
  const windowStart = now - config.velocityWindowMs;
  s.velocity = s.velocity.filter((e) => e.at >= windowStart);
}

/** Test helper: clear in-memory risk state. */
export function resetRiskState(): void {
  state.clear();
}
