import { useMemo } from "react";
import { encode } from "uqr";

/**
 * A QR code for a URL: how a computer hands a page to a phone, since it can't
 * read the NFC sticker. Always dark on white (with the standard four-module
 * quiet zone), whatever the theme, so every phone camera reads it.
 */
export function QrCode({ text, size = 168, label }: { text: string; size?: number; label: string }) {
  const { path, n } = useMemo(() => {
    const qr = encode(text, { ecc: "M", border: 4 });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, n: qr.size };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges" className="block shrink-0 rounded-xl" style={{ background: "#ffffff" }}>
      <path d={path} fill="#0b2545" />
    </svg>
  );
}
