import { useRef, useState } from 'react';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Btn, Card, Icon, Select, Spinner } from '../components/ui';
import { parseSpreadsheet, type ParsedSheet } from '../lib/io';
import { guessMapping, IMPORT_FIELDS, importProducts, type ImportResult, type Mapping } from '../lib/importer';
import { go } from '../router';

/** Screen 13: CSV/XLSX product import with a column-mapping step. */
export default function ImportPage() {
  const { t, toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [map, setMap] = useState<Mapping | null>(null);
  const [mode, setMode] = useState<'skip' | 'fill'>('skip');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  const load = async (f: File, sheet?: string) => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const p = await parseSpreadsheet(f, sheet);
      if (p.rows.length < 2) throw new Error('EMPTY');
      setFile(f);
      setParsed(p);
      setMap(guessMapping(p.rows[0]));
    } catch {
      setError(t('import.readError'));
      setParsed(null);
    } finally {
      setBusy(false);
    }
  };

  const headers = parsed?.rows[0] ?? [];
  const mapped = map && (map.reference >= 0 || map.barcode >= 0);

  const run = async () => {
    if (!parsed || !map) return;
    setBusy(true);
    try {
      const r = await importProducts(parsed.rows, map, mode);
      setResult(r);
      toast(t('import.done', { n: r.created }));
    } catch (e) {
      console.error(e);
      setError(t('err.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={t('nav.import')} back="/more">
      <Page>
        <Card className="space-y-3">
          <p className="text-sm text-white/60">{t('import.help')}</p>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          <Btn variant="primary" className="w-full" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="upload" /> {file ? file.name : t('import.choose')}
          </Btn>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </Card>

        {busy && <Spinner label={t('loading')} />}

        {parsed && map && !result && (
          <>
            {parsed.sheetNames.length > 1 && (
              <div>
                <p className="label">{t('import.sheet')}</p>
                <Select value={parsed.sheet} onChange={(e) => file && load(file, e.target.value)}>
                  {parsed.sheetNames.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </div>
            )}
            <Card className="space-y-3">
              <p className="font-semibold">{t('import.mapping')}</p>
              {IMPORT_FIELDS.map((f) => (
                <div key={f} className="grid grid-cols-2 items-center gap-3">
                  <span className="text-sm">
                    {t('import.field.' + f)}
                    {(f === 'reference' || f === 'barcode') && <span className="text-amber-300"> *</span>}
                  </span>
                  <Select value={map[f]} onChange={(e) => setMap({ ...map, [f]: Number(e.target.value) })}>
                    <option value={-1}>— {t('import.notMapped')} —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `#${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
              {!mapped && <p className="text-sm text-amber-300">{t('import.needId')}</p>}
            </Card>

            <Card className="space-y-2">
              <p className="font-semibold">{t('import.preview')} ({parsed.rows.length - 1} {t('import.rows')})</p>
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs">
                  <thead>
                    <tr className="text-white/40">
                      {IMPORT_FIELDS.filter((f) => map[f] >= 0).map((f) => (
                        <th key={f} className="px-2 py-1 text-start font-medium">
                          {t('import.field.' + f)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(1, 6).map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        {IMPORT_FIELDS.filter((f) => map[f] >= 0).map((f) => (
                          <td key={f} className="max-w-[9rem] truncate px-2 py-1.5">
                            {r[map[f]]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div>
              <p className="label">{t('import.existing')}</p>
              <Select value={mode} onChange={(e) => setMode(e.target.value as 'skip' | 'fill')}>
                <option value="skip">{t('import.modeSkip')}</option>
                <option value="fill">{t('import.modeFill')}</option>
              </Select>
            </div>
            <Btn variant="primary" className="w-full !min-h-16 text-lg" disabled={!mapped || busy} onClick={run}>
              <Icon name="check" /> {t('import.run')}
            </Btn>
          </>
        )}

        {result && (
          <Card className="space-y-3">
            <p className="text-lg font-bold">{t('import.result')}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-emerald-500/10 p-3"><div className="text-2xl font-bold">{result.created}</div><div className="text-xs text-white/50">{t('import.created')}</div></div>
              <div className="rounded-xl bg-accent/10 p-3"><div className="text-2xl font-bold">{result.updated}</div><div className="text-xs text-white/50">{t('import.updated')}</div></div>
              <div className="rounded-xl bg-white/5 p-3"><div className="text-2xl font-bold">{result.skipped}</div><div className="text-xs text-white/50">{t('import.skipped')}</div></div>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-xl bg-red-500/10 p-3 text-sm">
                <p className="mb-1 font-semibold text-red-300">
                  {result.errors.length} {t('import.errors')}
                </p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-white/70">
                  {result.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>
                      #{e.row}: {t('import.err.' + e.reason)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => { setResult(null); setParsed(null); setFile(null); }}>{t('import.another')}</Btn>
              <Btn variant="primary" onClick={() => go('/products')}>{t('nav.products')}</Btn>
            </div>
          </Card>
        )}
      </Page>
    </Shell>
  );
}
