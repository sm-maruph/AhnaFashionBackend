const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const { processMany } = require("../utils/image");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();

function coerce(body) {
  const b = { ...body };
  if (b.position !== undefined) b.position = Number(b.position) || 0;
  if (b.is_active !== undefined) b.is_active = String(b.is_active) === "true";
  return b;
}

// GET /api/hero  (public) — active slides, ordered
router.get("/", asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from("hero_slides").select("*").eq("is_active", true).order("position");
  if (error) throw error;
  res.set("Cache-Control", "public, max-age=120");
  res.json({ items: data });
}));

// GET /api/hero/all  (admin) — includes inactive
router.get("/all", authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin.from("hero_slides").select("*").order("position");
  if (error) throw error;
  res.json({ items: data });
}));

// POST /api/hero  (admin)
router.post("/", authenticate, requireAdmin, upload.single("image"), asyncHandler(async (req, res) => {
  const body = coerce(req.body);
  if (req.file) {
    const [up] = await processMany("banners", [req.file], { folder: "hero", thumb: false });
    body.image = up?.url || null;
  }
  if (!body.image) return res.status(400).json({ error: "An image is required" });
  const { data, error } = await supabaseAdmin.from("hero_slides").insert(body).select().single();
  if (error) throw error;
  res.status(201).json(data);
}));

// PUT /api/hero/:id  (admin)
router.put("/:id", authenticate, requireAdmin, upload.single("image"), asyncHandler(async (req, res) => {
  const body = coerce(req.body);
  if (req.file) {
    const [up] = await processMany("banners", [req.file], { folder: "hero", thumb: false });
    body.image = up?.url || null;
  }
  const { data, error } = await supabaseAdmin.from("hero_slides").update(body).eq("id", req.params.id).select().single();
  if (error) throw error;
  res.json(data);
}));

// DELETE /api/hero/:id  (admin)
router.delete("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from("hero_slides").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

module.exports = router;
