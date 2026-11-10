import { useMemo } from 'react';
import { encodeCode128, type SvgBarcodeOptions } from '../lib/code128';

interface BarcodeViewProps extends SvgBarcodeOptions {
  text: string;
  className?: string;
  showText?: boolean;
}

export function BarcodeView({
  text,
  height = 56,
  moduleWidth = 2,
  showText = true,
  fontSize = 13,
  textMargin = 4,
  color = '#000000',
  background = '#ffffff',
  className = '',
}: BarcodeViewProps) {
  const encoded = useMemo(() => {
    if (!text) return null;
    try {
      return encodeCode128(text);
    } catch {
      return null;
    }
  }, [text]);

  if (!encoded || !text) {
    return <div className={`flex items-center justify-center p-2 text-xs text-white/40 ${className}`}>—</div>;
  }

  const totalWidth = encoded.totalModules * moduleWidth;
  const barHeight = showText ? Math.max(24, height - fontSize - textMargin) : height;
  const totalHeight = showText ? barHeight + fontSize + textMargin + 2 : height;

  return (
    <div className={`inline-flex flex-col items-center overflow-hidden rounded bg-white p-1 text-black ${className}`}>
      <svg
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        width={totalWidth}
        height={totalHeight}
        shapeRendering="crispEdges"
        className="max-h-full max-w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="100%" height="100%" fill={background} />
        {encoded.bars.map((bar, idx) => (
          <rect
            key={idx}
            x={bar.x * moduleWidth}
            y={0}
            width={bar.width * moduleWidth}
            height={barHeight}
            fill={color}
          />
        ))}
        {showText && (
          <text
            x={totalWidth / 2}
            y={barHeight + fontSize + textMargin - 1}
            fill={color}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
            fontSize={fontSize}
            fontWeight={600}
            textAnchor="middle"
            letterSpacing="1px"
          >
            {text}
          </text>
        )}
      </svg>
    </div>
  );
}

