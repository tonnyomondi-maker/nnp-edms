import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

interface Body {
  email: string;
  full_name: string;
  department: string;
  pf_number?: string;
  is_test_user?: boolean;
  roles?: string[]; // optional extra roles beyond TRAINER
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) return json({ error: "Invalid token" }, 401);

    // Must be SUPER_ADMIN
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "SUPER_ADMIN").maybeSingle();
    if (!roleRow) return json({ error: "Only Super Admin may create users" }, 403);

    const body = (await req.json()) as Body;
    if (!body.email || !body.full_name || !body.department) return json({ error: "email, full_name, department required" }, 400);

    const tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 14) + "A1!";
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: body.full_name, department: body.department, pf_number: body.pf_number ?? "" },
    });
    if (cErr || !created.user) return json({ error: cErr?.message || "Create failed" }, 400);

    // Ensure profile (handle_new_user trigger should also fire)
    await admin.from("profiles").upsert({
      user_id: created.user.id,
      full_name: body.full_name,
      email: body.email,
      department: body.department,
      pf_number: body.pf_number ?? null,
      is_test_user: !!body.is_test_user,
    }, { onConflict: "user_id" });

    const wanted = new Set<string>(["TRAINER", ...(body.roles ?? [])]);
    for (const r of wanted) {
      await admin.from("user_roles").insert({ user_id: created.user.id, role: r }).then(() => {}, () => {});
    }

    // Send password-reset email so the user sets their own password
    await admin.auth.resetPasswordForEmail(body.email).catch(() => {});

    return json({ user_id: created.user.id, email: body.email, temp_password: tempPassword });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
