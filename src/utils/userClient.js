// Build a Supabase client that acts AS the request's user (RLS + auth.uid() apply).
// Falls back to anon (guest) when there's no token — needed for guest checkout.
const { createClient } = require("@supabase/supabase-js");
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

function userClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
  });
}
module.exports = { userClient };
