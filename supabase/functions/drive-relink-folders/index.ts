import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const FOLDER_MIME = "application/vnd.google-apps.folder";

async function driveList(lovableKey: string, gdriveKey: string, q: string) {
  const url = `${GATEWAY}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents,trashed)&pageSize=100`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gdriveKey } });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Drive list ${r.status}: ${txt.slice(0, 200)}`);
  return (JSON.parse(txt).files || []) as Array<{ id: string; name: string; parents?: string[]; trashed?: boolean }>;
}

async function driveCreateFolder(lovableKey: string, gdriveKey: string, name: string, parentId: string | null) {
  const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  const r = await fetch(`${GATEWAY}/drive/v3/files?fields=id,name`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": gdriveKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Drive create folder ${r.status}: ${txt.slice(0, 200)}`);
  return JSON.parse(txt) as { id: string; name: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
    const gdriveKey = Deno.env.get("GOOGLE_DRIVE_API_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: isSuper } = await admin.rpc("has_role", { _user_id: userId, _role: "SUPER_ADMIN" });
    if (!isSuper) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const mode: "discover" | "create" = body?.mode === "create" ? "create" : "discover";
    const rootName: string = (body?.rootFolderName || "EDMS").trim();

    // Distinct departments
    const { data: profs } = await admin.from("profiles").select("department").not("department", "is", null);
    const departments = Array.from(new Set((profs || []).map((p: any) => p.department).filter(Boolean))).sort();

    // Find or create root
    const rootMatches = await driveList(
      lovableKey, gdriveKey,
      `name='${rootName.replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and trashed=false and 'root' in parents`,
    );
    let root = rootMatches[0] ?? null;
    if (!root && mode === "create") {
      root = await driveCreateFolder(lovableKey, gdriveKey, rootName, null);
    }

    const map: Array<Record<string, unknown>> = [];
    if (root) map.push({ scope: "root", department: null, folder_id: root.id, folder_name: root.name });

    // Departments
    if (root) {
      const children = await driveList(
        lovableKey, gdriveKey,
        `'${root.id}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
      );
      for (const dept of departments) {
        let f = children.find((c) => c.name === dept) ?? null;
        if (!f && mode === "create") {
          f = await driveCreateFolder(lovableKey, gdriveKey, dept, root.id);
        }
        if (f) map.push({ scope: "department", department: dept, folder_id: f.id, folder_name: f.name });
      }
    }

    if (mode === "create" && map.length) {
      // Reset + upsert
      await admin.from("drive_folder_map").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await admin.from("drive_folder_map").insert(map.map((m) => ({ ...m, updated_by: userId })));
    }

    return new Response(JSON.stringify({ mode, root: root ?? null, map, departments }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
