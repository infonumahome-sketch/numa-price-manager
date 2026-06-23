import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase con la "service role key".
 *
 * ⚠️ IMPORTANTE:
 * - Este cliente IGNORA las políticas de RLS (Row Level Security).
 * - Usar SOLO en código que corre en el servidor (Route Handlers,
 *   scripts del scraper, etc.), NUNCA en componentes de cliente.
 * - La variable SUPABASE_SERVICE_ROLE_KEY no debe tener el prefijo
 *   NEXT_PUBLIC_ para que no se incluya en el bundle del navegador.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
