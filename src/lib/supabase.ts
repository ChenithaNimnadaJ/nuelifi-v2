import { createClient } from "@supabase/supabase-js";

const env = import.meta.env as Record<string, string | undefined>;
// These are intentionally public Supabase browser values. Keep service-role and AI keys server-side.
const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "https://mtfqktpfcwoigmpmdkwh.supabase.co";
const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_fbAiXHcYmh4t2Scj3Fsqew_LnSw2tZK";

export const supabase = createClient(url, publishableKey);
