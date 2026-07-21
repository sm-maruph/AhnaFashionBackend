// Two clients:
//  - supabaseAdmin: service role, bypasses RLS. SERVER ONLY. Use for trusted writes.
//  - supabasePublic: anon key. Use for auth (signUp/signIn).
// To act *as a logged-in user* (so RLS + auth.uid() apply), see utils/userClient.js
const { createClient } = require("@supabase/supabase-js");

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase env vars (URL / ANON / SERVICE_ROLE).");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = { supabaseAdmin, supabasePublic };
