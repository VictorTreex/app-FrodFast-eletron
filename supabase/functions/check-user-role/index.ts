import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALLOWED_ORIGINS = [
  "https://treexonline.online",
  "https://www.treexonline.online",
  "http://localhost:8080",
  "http://localhost:5173",
]

function getCorsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  }
}

function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"))

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return json({ error: "Missing auth" }, 401, corsHeaders);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 🔐 user client
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: userData, error: userErr } =
      await userClient.auth.getUser();

    if (userErr || !userData.user) {
      return json({ error: "Unauthorized" }, 401, corsHeaders);
    }

    // 🔐 admin client
    const admin = createClient(supabaseUrl, serviceKey);

    // Parse request body
    const body = await req.json();
    const { user_id, role } = body;

    if (!user_id || !role) {
      return json({ error: "user_id and role are required" }, 400, corsHeaders);
    }

    // Validar role permitido
    const allowedRoles = ["admin", "user"];
    if (!allowedRoles.includes(role)) {
      return json({ error: "Invalid role" }, 400, corsHeaders);
    }

    // Verificar se usuário pode consultar roles (só admin ou próprio usuário)
    if (user_id !== userData.user.id) {
      // Se não for o próprio usuário, verificar se é admin
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (!roleRow) {
        return json({ error: "Insufficient permissions" }, 403, corsHeaders);
      }
    }

    // Consultar role do usuário
    const { data, error } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user_id)
      .eq("role", role)
      .maybeSingle();

    if (error) {
      return json({ error: "Database error" }, 500, corsHeaders);
    }

    // Retornar resultado
    return json({
      hasRole: !!data,
      role: data?.role || null,
    }, 200, corsHeaders);

  } catch (error) {
    console.error("Error in check-user-role:", error);
    return json({ error: "Internal server error" }, 500, corsHeaders);
  }
});
