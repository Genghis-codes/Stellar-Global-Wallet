import qrcode from "qrcode-generator";
import { cn } from "@/lib/cn";

export interface QrCodeProps {
  value: string;
  /** Rendered size in CSS pixels. */
  size?: number;
  /** Accessible name for the image. */
  label?: string;
  className?: string;
}

/** Dark modules as one SVG path, so the QR scales crisply and follows the theme colours. */
export function qrPath(value: string): { path: string; modules: number } {
  // Type 0 = smallest version that fits; "M" error correction survives a scuffed print.
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const modules = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { path, modules };
}

/**
 * A QR code drawn as inline SVG. Always dark-on-light (scanners expect it),
 * on a white quiet zone even in dark mode.
 */
export function QrCode({ value, size = 192, label = "QR code", className }: QrCodeProps) {
  const { path, modules } = qrPath(value);
  const quiet = 4;
  const box = modules + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      shapeRendering="crispEdges"
      className={cn("rounded-lg", className)}
    >
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
