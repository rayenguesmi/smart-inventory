/**
 * Professional Code 128 (Subset B) barcode generator.
 * Produces crisp, high-contrast, perfectly scannable vector SVG and data URLs.
 */

const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

export interface Code128Bar {
  x: number;
  width: number;
}

export interface EncodedCode128 {
  text: string;
  totalModules: number;
  bars: Code128Bar[];
  quietModules: number;
}

/**
 * Encodes ASCII text into Code 128 (Subset B) bar modules.
 */
export function encodeCode128(text: string, quietModules = 10): EncodedCode128 {
  // Subset B starts with code 104
  const codes: number[] = [104];
  let checksum = 104;

  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    // Code 128 Subset B covers ASCII 32..126
    const code = charCode >= 32 && charCode <= 126 ? charCode - 32 : 0;
    codes.push(code);
    checksum += code * (i + 1);
  }

  codes.push(checksum % 103);
  codes.push(106); // Stop code

  const bars: Code128Bar[] = [];
  let currentModule = quietModules;

  for (const c of codes) {
    const pattern = PATTERNS[c] ?? PATTERNS[0];
    let isBar = true;
    for (let j = 0; j < pattern.length; j++) {
      const w = parseInt(pattern[j], 10);
      if (isBar) {
        bars.push({ x: currentModule, width: w });
      }
      currentModule += w;
      isBar = !isBar;
    }
  }

  const totalModules = currentModule + quietModules;
  return { text, totalModules, bars, quietModules };
}

export interface SvgBarcodeOptions {
  height?: number;
  moduleWidth?: number;
  includeText?: boolean;
  fontSize?: number;
  textMargin?: number;
  color?: string;
  background?: string;
}

/**
 * Returns raw SVG string for a Code 128 barcode.
 */
export function generateCode128Svg(text: string, options: SvgBarcodeOptions = {}): string {
  const {
    height = 50,
    moduleWidth = 2,
    includeText = false,
    fontSize = 12,
    textMargin = 4,
    color = '#000000',
    background = '#ffffff',
  } = options;

  const encoded = encodeCode128(text);
  const totalWidth = encoded.totalModules * moduleWidth;
  const barHeight = includeText ? Math.max(20, height - fontSize - textMargin) : height;
  const totalHeight = includeText ? barHeight + fontSize + textMargin + 2 : height;

  const barRects = encoded.bars
    .map(
      (b) =>
        `<rect x="${(b.x * moduleWidth).toFixed(1)}" y="0" width="${(b.width * moduleWidth).toFixed(1)}" height="${barHeight}" fill="${color}" />`
    )
    .join('');

  const textElement = includeText
    ? `<text x="${(totalWidth / 2).toFixed(1)}" y="${(barHeight + fontSize + textMargin).toFixed(1)}" fill="${color}" font-family="monospace, monospace" font-size="${fontSize}" font-weight="600" text-anchor="middle" letter-spacing="1">${escapeXml(text)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="${background}" />
  ${barRects}
  ${textElement}
</svg>`;
}

/**
 * Returns a data URL (`data:image/svg+xml;utf8,...`) suitable for <img> src or PDF embedding.
 */
export function generateCode128DataUrl(text: string, options: SvgBarcodeOptions = {}): string {
  const svg = generateCode128Svg(text, options);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '\'':
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

