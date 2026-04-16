import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data, error } = await supabase.auth.admin.createUser({
    email: "tonny.omondi@nyamirapoly.ac.ke",
    password: "Ny@Poly#2026%",
    email_confirm: true,
    user_metadata: { full_name: "Tonny Omondi" },
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Assign DP_ACADEMICS (admin) role
  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({ user_id: data.user.id, role: "DP_ACADEMICS" });

  return new Response(
    JSON.stringify({ success: true, user_id: data.user.id, roleError: roleError?.message }),
    { headers: { "Content-Type": "application/json" } }
  );
});
