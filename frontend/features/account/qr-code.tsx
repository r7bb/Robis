'use client';

import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * A QR code for `text`, drawn as SVG squares from the library's module
 * grid, so no markup from anywhere is put into the page. Dark on white with
 * a quiet zone, as scanners expect, whatever the theme.
 */
export function QrCode({
  text,
  label,
  size = 176,
}: {
  text: string;
  label: string;
  size?: number;
}) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const dark: { x: number; y: number }[] = [];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) if (qr.isDark(y, x)) dark.push({ x, y });
    }
    return { count, dark };
  }, [text]);
  const quiet = 4;
  const span = cells.count + quiet * 2;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-md"
    >
      <rect width={span} height={span} fill="#ffffff" />
      {cells.dark.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width={1} height={1} fill="#111111" />
      ))}
    </svg>
  );
}
