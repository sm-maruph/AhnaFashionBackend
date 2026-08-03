const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();

// The public list is used by product forms and the storefront. Inactive sizes
// remain attached to old products, but cannot be selected for new ones.
router.get("/", asyncHandler(async (req, res) => {
  let query = supabaseAdmin.from("sizes").select("id,name,sort_order,is_active").order("sort_order").order("name");
  if (req.query.all !== "true") query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  res.json({ items: data || [] });
}));

router.post("/", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Size name is required" });
  const { data, error } = await supabaseAdmin.from("sizes").insert({
    name,
    sort_order: Math.max(0, Number(req.body.sort_order) || 0),
    is_active: req.body.is_active !== false,
  }).select().single();
  if (error) throw error;
  res.status(201).json(data);
}));

router.patch("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.name !== undefined) {
    patch.name = String(req.body.name).trim();
    if (!patch.name) return res.status(400).json({ error: "Size name is required" });
  }
  if (req.body.sort_order !== undefined) patch.sort_order = Math.max(0, Number(req.body.sort_order) || 0);
  if (req.body.is_active !== undefined) patch.is_active = Boolean(req.body.is_active);
  const { data, error } = await supabaseAdmin.from("sizes").update(patch).eq("id", req.params.id).select().single();
  if (error) throw error;
  res.json(data);
}));

router.delete("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { count, error: countError } = await supabaseAdmin.from("product_size_inventory")
    .select("id", { count: "exact", head: true }).eq("size_id", req.params.id);
  if (countError) throw countError;
  if (count > 0) return res.status(409).json({ error: "This size is used by products. Deactivate it instead." });
  const { error } = await supabaseAdmin.from("sizes").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

module.exports = router;
