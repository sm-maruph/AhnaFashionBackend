const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const { processMany } = require("../utils/image");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();

// GET /api/collections (public)
router.get("/", asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from("collections").select("*").eq("is_active", true).order("position");
  if (error) throw error;
  res.set("Cache-Control", "public, max-age=120");
  res.json({ items: data });
}));

// GET /api/collections/all (admin) — includes inactive
router.get("/all", authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin.from("collections").select("*").order("position");
  if (error) throw error;
  res.json({ items: data });
}));

router.post("/", authenticate, requireAdmin, upload.single("image"), asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (body.position !== undefined) body.position = Number(body.position) || 0;
  if (body.is_active !== undefined) body.is_active = String(body.is_active) === "true";
  if (req.file) {
    const [up] = await processMany("banners", [req.file], { folder: "collections", thumb: false });
    body.image = up?.url || null;
  }
  if (!body.image) return res.status(400).json({ error: "An image is required" });
  const { data, error } = await supabaseAdmin.from("collections").insert(body).select().single();
  if (error) throw error;
  res.status(201).json(data);
}));

router.put("/:id", authenticate, requireAdmin, upload.single("image"), asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (body.position !== undefined) body.position = Number(body.position) || 0;
  if (body.is_active !== undefined) body.is_active = String(body.is_active) === "true";
  if (req.file) {
    const [up] = await processMany("banners", [req.file], { folder: "collections", thumb: false });
    body.image = up?.url || null;
  }
  const { data, error } = await supabaseAdmin.from("collections").update(body).eq("id", req.params.id).select().single();
  if (error) throw error;
  res.json(data);
}));

router.delete("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from("collections").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

module.exports = router;
