const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { validate } = require("../middleware/validate");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { supabaseAdmin } = require("../config/supabase");
const { couponValidateSchema } = require("../validators/schemas");
const { evaluateCoupon } = require("../utils/couponPricing");

const router = express.Router();

// POST /api/coupons/validate  (public) — secure server-side check + discount calc
router.post("/validate", validate(couponValidateSchema), asyncHandler(async (req, res) => {
  // Uses the SAME helper as order placement so the preview always matches the saved order.
  const r = await evaluateCoupon(req.body.code, req.body.subtotal);
  if (!r.valid) return res.status(400).json({ valid: false, error: r.error || "Invalid coupon" });
  res.json({ valid: true, code: r.code, type: r.type, discount: r.discount, freeShipping: r.freeShipping });
}));

// Admin CRUD
router.get("/", authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin.from("coupons").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  res.json({ items: data });
}));
router.post("/", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("coupons").insert(req.body).select().single();
  if (error) throw error;
  res.status(201).json(data);
}));
router.put("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("coupons").update(req.body).eq("id", req.params.id).select().single();
  if (error) throw error;
  res.json(data);
}));
router.delete("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from("coupons").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

module.exports = router;
