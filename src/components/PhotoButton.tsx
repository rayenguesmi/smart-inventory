import { useRef, type ReactNode } from 'react';

/** Opens the phone camera through the native file picker (works on every mobile browser, no permission prompt code needed). */
export default function PhotoButton({ onFile, children, className = 'btn btn-primary', multiple = false }: { onFile: (f: File) => void; children: ReactNode; className?: string; multiple?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          files.forEach(onFile);
          e.target.value = '';
        }}
      />
    </>
  );
}
