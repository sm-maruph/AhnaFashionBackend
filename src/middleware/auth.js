// Verify the Supabase access token and attach req.user.
// Verifies via Supabase (works with ANY JWT alg: HS256/ES256).
const { supabaseAdmin } = require("../config/supabase");

async function resolveUser(token) {
  if (!token) return null;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  const user = await resolveUser(token);
  if (!user) return res.status(401).json({ error: "Invalid or expired token" });
  req.user = user;
  req.accessToken = token;
  next();
}

async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    const user = await resolveUser(token);
    if (user) {
      req.user = user;
      req.accessToken = token;
    }
  }
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", req.user.id)
    .single();
  if (error || !data || data.role !== "admin") {
    return res.status(403).json({ error: "Admin access only" });
  }
  next();
}

module.exports = { authenticate, optionalAuth, requireAdmin };