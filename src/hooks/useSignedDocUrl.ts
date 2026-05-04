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
