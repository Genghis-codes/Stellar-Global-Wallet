import { describeError } from "@/lib/api/errors";
import { isWalletError } from "@/lib/wallet/types";

/**
 * A user-facing sentence for a failed sign/submit, or null when the user
 * simply declined in their wallet (no error to show).
 */
export function describeTxError(error: unknown): string | null {
  if (isWalletError(error)) {
    switch (error.code) {
      case "USER_REJECTED":
        return null;
      case "NOT_INSTALLED":
        return "Freighter isn't available. Install or unlock it and try again.";
      case "WRONG_NETWORK":
        return error.message || "Your wallet is on a different network than GlobeWallet.";
      default:
        return error.message || "Your wallet couldn't sign the transaction.";
    }
  }
  return describeError(error);
}
