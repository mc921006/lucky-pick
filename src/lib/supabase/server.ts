import { createClient } from "@supabase/supabase-js";

function getRequiredServerEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} environment variable is not configured.`);
  }

  return value;
}

/**
 * Service-role client for trusted server code only.
 * Do not import this module from Client Components or expose its values.
 */
export function createServerSupabaseClient() {
  return createClient(
    getRequiredServerEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredServerEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
