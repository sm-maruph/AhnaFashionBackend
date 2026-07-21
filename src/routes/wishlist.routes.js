const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();
router.use(authenticate);

// GET /api/wishlist -> items joined with product
router.get("/", asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("wishlist_items")
    .select("id,product:products(id,slug,name,brand,image,price,old_price,rating,reviews_count,in_stock,category_id)")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  res.json({ items: data });
}));

// POST /api/wishlist  { product_id } -> add (ignore if already there)
router.post("/", asyncHandler(async (req, res) => {
  const { product_id } = req.body;
  if (!product_id) return res.status(400).json({ error: "product_id required" });
  const { error } = await supabaseAdmin
    .from("wishlist_items")
    .upsert({ user_id: req.user.id, product_id }, { onConflict: "user_id,product_id", ignoreDuplicates: true });
  if (error) throw error;
  res.status(201).json({ success: true });
}));

// DELETE /api/wishlist/:productId -> remove
router.delete("/:productId", asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin
    .from("wishlist_items")
    .delete().eq("user_id", req.user.id).eq("product_id", req.params.productId);
  if (error) throw error;
  res.json({ success: true });
}));

module.exports = router;
