import { useEffect, useState } from 'react';

function parse() {
  const h = window.location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) as Record<string, string> };
}

export function useRoute() {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const f = () => setR(parse());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}

export function go(path: string, replace = false) {
  if (replace) window.location.replace('#' + path);
  else window.location.hash = path;
}

export function goBack(fallback = '/') {
  if (window.history.length > 1) window.history.back();
  else go(fallback, true);
}
