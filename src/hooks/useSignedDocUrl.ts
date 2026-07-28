import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Convert a value that might be a public Supabase storage URL OR a bare path
 * into { bucket, path }. Returns null if it can't be parsed.
 *
 * Examples handled:
 *   https://xyz.supabase.co/storage/v1/object/public/documents/uid/file.pdf
 *   https://xyz.supabase.co/storage/v1/object/documents/uid/file.pdf
 *   uid/2026_JAN_APR/UNIT/Doc_1.pdf       (bare path; assumes 'documents')
 */
export function parseStorageRef(
  value: string | null | undefined,
  defaultBucket = 'documents',
): { bucket: string; path: string } | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:public\/|sign\/)?([^/]+)\/(.+?)(?:\?|$)/);
    if (m) return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) };
    return null;
  } catch {
    // Not a URL — treat as bare path in the default bucket
    if (value.startsWith('/')) value = value.slice(1);
    return { bucket: defaultBucket, path: value };
  }
}

interface SignedUrlState {
  url: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// Module-level cache so multiple components viewing the same document don't
// re-sign the URL repeatedly. Cached entries expire 60s before the signed URL
// itself does, so we never hand out a stale URL.
interface CacheEntry { url: string; expiresAt: number }
const signedUrlCache = new Map<string, CacheEntry>();
const SAFETY_MARGIN_MS = 60_000;

export function clearSignedUrlCache(fileRef?: string) {
  if (!fileRef) { signedUrlCache.clear(); return; }
  const ref = parseStorageRef(fileRef);
  if (!ref) return;
  signedUrlCache.delete(`${ref.bucket}:${ref.path}`);
}

/**
 * Returns a fresh signed URL for a private storage object. Re-signs every
 * `expiresIn` seconds (default 1 hour) so previews stay valid.
 */
export function useSignedDocUrl(
  fileRef: string | null | undefined,
  options: { expiresIn?: number; enabled?: boolean } = {},
): SignedUrlState {
  const { expiresIn = 3600, enabled = true } = options;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !fileRef) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }
    const ref = parseStorageRef(fileRef);
    if (!ref) {
      setError('Could not parse storage reference');
      setUrl(null);
      return;
    }

    const cacheKey = `${ref.bucket}:${ref.path}`;
    const cached = signedUrlCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      setUrl(cached.url);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase.storage
      .from(ref.bucket)
      .createSignedUrl(ref.path, expiresIn)
      .then(({ data, error: signErr }) => {
        if (cancelled) return;
        if (signErr || !data?.signedUrl) {
          setError(signErr?.message || 'Could not load preview');
          setUrl(null);
        } else {
          signedUrlCache.set(cacheKey, {
            url: data.signedUrl,
            expiresAt: Date.now() + expiresIn * 1000 - SAFETY_MARGIN_MS,
          });
          setUrl(data.signedUrl);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load preview');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileRef, expiresIn, enabled, nonce]);

  return { url, loading, error, reload };
}

/**
 * Resolve a signature/stamp value (either a legacy public URL or a bare
 * path in the private `signatures` bucket) into an image URL usable in
 * `<img src>`. Returns empty string if input is empty.
 */
export async function resolveSignatureUrl(
  value: string | null | undefined,
  expiresIn = 3600,
): Promise<string> {
  if (!value) return '';
  if (/^https?:\/\//i.test(value) && value.includes('/storage/v1/object/public/')) return value;
  const ref = parseStorageRef(value, 'signatures');
  if (!ref) return '';
  const { data, error } = await supabase.storage.from(ref.bucket).createSignedUrl(ref.path, expiresIn);
  if (error || !data?.signedUrl) return '';
  return data.signedUrl;
}

/** Get (or fetch) a cached signed URL imperatively — used by approval flows. */
export async function getCachedSignedUrl(
  fileRef: string | null | undefined,
  expiresIn = 3600,
): Promise<string> {
  const ref = parseStorageRef(fileRef);
  if (!ref) throw new Error('Storage reference is invalid');
  const cacheKey = `${ref.bucket}:${ref.path}`;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data, error } = await supabase.storage.from(ref.bucket).createSignedUrl(ref.path, expiresIn);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not sign URL');
  signedUrlCache.set(cacheKey, {
    url: data.signedUrl,
    expiresAt: Date.now() + expiresIn * 1000 - SAFETY_MARGIN_MS,
  });
  return data.signedUrl;
}
