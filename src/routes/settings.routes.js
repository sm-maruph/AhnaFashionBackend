const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const { processMany } = require("../utils/image");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();

const ALLOWED = [
  "store_name", "tagline", "currency", "support_email", "support_phone", "logo",
  "address", "city", "hours", "delivery_inside", "delivery_outside",
  "free_delivery_threshold", "payments", "social", "maintenance", "theme",
];

function clean(body) {
  const out = {};
  for (const k of ALLOWED) if (body[k] !== undefined) out[k] = body[k];
  // coerce numbers
  ["delivery_inside", "delivery_outside", "free_delivery_threshold"].forEach((k) => {
    if (out[k] !== undefined) out[k] = Number(out[k]) || 0;
  });
  // parse JSON fields if they arrive as strings (multipart)
  ["payments", "social", "theme"].forEach((k) => {
    if (typeof out[k] === "string") { try { out[k] = JSON.parse(out[k]); } catch { /* ignore */ } }
  });
  if (out.maintenance !== undefined) out.maintenance = String(out.maintenance) === "true" || out.maintenance === true;
  return out;
}

// GET /api/settings  (public)
router.get("/", asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin.from("store_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  res.set("Cache-Control", "public, max-age=60");
  res.json(data);
}));

// PUT /api/settings  (admin) — JSON or multipart (logo file)
router.put("/", authenticate, requireAdmin, upload.single("logo"), asyncHandler(async (req, res) => {
  const patch = clean(req.body);
  if (req.file) {
    const [up] = await processMany("logos", [req.file], { folder: "store", thumb: false });
    patch.logo = up?.url || patch.logo;
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("store_settings").update(patch).eq("id", 1).select().single();
  if (error) throw error;
  res.json(data);
}));

module.exports = router;
