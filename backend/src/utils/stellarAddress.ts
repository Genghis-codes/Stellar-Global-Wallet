export function isGAddress(value: string): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return value.startsWith("G") && value.length === 56;
}

export const publicKeyMessage =
  "Invalid public key: only G... addresses are supported. Muxed (M...) addresses are not accepted; use the underlying G... address instead.";

export const destinationMessage =
  "Invalid destination: only G... addresses are supported. Muxed (M...) addresses are not accepted; use the underlying G... address instead.";
