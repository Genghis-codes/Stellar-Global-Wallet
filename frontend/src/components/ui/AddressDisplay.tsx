import { cn } from "@/lib/cn";
import { truncateAddress } from "@/lib/format";
import { CopyButton } from "./CopyButton";

export interface AddressDisplayProps {
  address: string;
  /** Characters kept at each end. Default 4. */
  chars?: number;
  /** Show the full address instead of truncating. */
  full?: boolean;
  copyable?: boolean;
  /** Optional link (e.g. an explorer URL) for the address text. */
  href?: string;
  className?: string;
}

/** A Stellar address in monospace, truncated with the full value in a tooltip, plus copy. */
export function AddressDisplay({
  address,
  chars = 4,
  full = false,
  copyable = true,
  href,
  className,
}: AddressDisplayProps) {
  const text = full ? address : truncateAddress(address, chars, chars);
  const content = (
    <span className="font-mono text-sm" title={address}>
      {text}
    </span>
  );
  return (
    <span className={cn("inline-flex items-center gap-1 text-fg", full && "break-all", className)}>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
          {content}
        </a>
      ) : (
        content
      )}
      {copyable && <CopyButton value={address} label="Copy address" />}
    </span>
  );
}
