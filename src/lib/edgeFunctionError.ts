// supabase.functions.invoke() has a footgun: when the edge function returns a
// non-2xx status, `data` comes back null and `error.message` is always the
// generic "Edge Function returned a non-2xx status code" — the real reason
// (the JSON body the function actually sent, e.g. { error: "..." }) is only
// reachable via `error.context`, which is the raw Response object.
//
// This helper pulls the real message out of that Response so error toasts /
// thrown errors show the actual cause instead of the generic wrapper text.
export async function getEdgeFunctionErrorMessage(
  error: unknown,
  data: unknown,
  fallback: string,
): Promise<string> {
  // Happy-ish path: function returned 2xx but with an `{ error }` payload.
  const dataError = (data as { error?: string } | null)?.error;
  if (dataError) return dataError;

  if (!error) return fallback;

  const err = error as { message?: string; context?: Response };

  // FunctionsHttpError (and similar) carry the original Response on `.context`.
  const ctx = err.context;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      try {
        const text = await ctx.clone().text();
        if (text) return text.slice(0, 500);
      } catch {
        // fall through to generic message below
      }
    }
  }

  return err.message || fallback;
}
