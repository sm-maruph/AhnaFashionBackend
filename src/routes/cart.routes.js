const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();
router.use(authenticate); // cart is always user-scoped

// GET /api/cart  -> items joined with product info
router.get("/", asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("cart_items")
    .select("id,size,color,qty,product:products(id,slug,name,image,price,old_price,stock)")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  res.json({ items: data });
}));

// POST /api/cart  { product_id, size, color, qty } -> add or increment
router.post("/", asyncHandler(async (req, res) => {
  const { product_id, size = null, color = null, qty = 1 } = req.body;
  if (!product_id) return res.status(400).json({ error: "product_id required" });

  const { data: rows } = await supabaseAdmin
    .from("cart_items").select("id,qty,size,color")
    .eq("user_id", req.user.id).eq("product_id", product_id);
  const match = (rows || []).find((r) => (r.size || null) === (size || null) && (r.color || null) === (color || null));

  if (match) {
    const { data, error } = await supabaseAdmin.from("cart_items")
      .update({ qty: match.qty + Number(qty) }).eq("id", match.id).select().single();
    if (error) throw error;
    return res.json(data);
  }
  const { data, error } = await supabaseAdmin.from("cart_items")
    .insert({ user_id: req.user.id, product_id, size, color, qty: Number(qty) }).select().single();
  if (error) throw error;
  res.status(201).json(data);
}));

// PATCH /api/cart/:id  { qty } -> set quantity (min 1)
router.patch("/:id", asyncHandler(async (req, res) => {
  const qty = Math.max(1, Number(req.body.qty || 1));
  const { data, error } = await supabaseAdmin.from("cart_items")
    .update({ qty }).eq("id", req.params.id).eq("user_id", req.user.id).select().single();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: "Cart item not found" });
  res.json(data);
}));

// DELETE /api/cart/:id -> remove one
router.delete("/:id", asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from("cart_items")
    .delete().eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) throw error;
  res.json({ success: true });
}));

// DELETE /api/cart -> clear cart
router.delete("/", asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from("cart_items").delete().eq("user_id", req.user.id);
  if (error) throw error;
  res.json({ success: true });
}));

module.exports = router;
