import { useEffect, useState } from 'react';
import { db } from '../db';
import { uid } from './util';

/** Downscale a camera photo (keeps IndexedDB small: ~100 KB instead of 4 MB). */
export async function resizeImage(file: Blob, max = 1024, quality = 0.75): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    // very old browsers: keep the original
    return file;
  }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  return blob ?? file;
}

export async function savePhoto(file: Blob): Promise<string> {
  const blob = await resizeImage(file);
  const id = uid();
  await db.photos.add({ id, blob, createdAt: Date.now() });
  return id;
}

export function usePhotoUrl(id?: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let dead = false;
    let created: string | undefined;
    setUrl(undefined);
    if (!id) return;
    db.photos.get(id).then((p) => {
      if (dead || !p) return;
      created = URL.createObjectURL(p.blob);
      setUrl(created);
    });
    return () => {
      dead = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [id]);
  return url;
}
