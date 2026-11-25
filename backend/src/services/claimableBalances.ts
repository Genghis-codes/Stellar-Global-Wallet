/**
 * Route-facing helpers for the close-account (#288) and claimable-balance
 * (#289) flows. The Horizon work lives on StellarService; these adapt the
 * route parameters (`publicKey`, paging, `dryRun`) to it.
 */
import type {
  ClaimClaimableBalanceBuild,
  ClaimableBalanceList,
  CloseAccountBuild,
  CloseAccountDryRun,
  StellarService,
} from "./stellar";

type ClaimableBalanceService = Pick<
  StellarService,
  | "buildCloseAccountTransaction"
  | "dryRunCloseAccount"
  | "listClaimableBalances"
  | "buildClaimClaimableBalanceTransaction"
  | "buildReclaimClaimableBalanceTransaction"
>;

export async function buildAccountClose(
  stellar: ClaimableBalanceService,
  params: { publicKey: string; destination: string; dryRun?: boolean }
): Promise<CloseAccountBuild | CloseAccountDryRun> {
  const request = { account: params.publicKey, destination: params.destination };
  return params.dryRun
    ? stellar.dryRunCloseAccount(request)
    : stellar.buildCloseAccountTransaction(request);
}

export async function listClaimableBalances(
  stellar: ClaimableBalanceService,
  params: { publicKey: string; limit: number; cursor?: string }
): Promise<ClaimableBalanceList> {
  return stellar.listClaimableBalances(params.publicKey, {
    limit: params.limit,
    cursor: params.cursor,
  });
}

export async function buildClaimableBalanceClaim(
  stellar: ClaimableBalanceService,
  params: { publicKey: string; balanceId: string }
): Promise<ClaimClaimableBalanceBuild> {
  return stellar.buildClaimClaimableBalanceTransaction({
    account: params.publicKey,
    balanceId: params.balanceId,
  });
}

export async function buildClaimableBalanceReclaim(
  stellar: ClaimableBalanceService,
  params: { publicKey: string; balanceId: string }
): Promise<ClaimClaimableBalanceBuild> {
  return stellar.buildReclaimClaimableBalanceTransaction({
    account: params.publicKey,
    balanceId: params.balanceId,
  });
}
