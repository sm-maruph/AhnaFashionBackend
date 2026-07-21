const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { optionalAuth } = require("../middleware/auth");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();

// GET /api/reviews/:productId  (public) — list + summary
router.get("/:productId", asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("product_reviews")
    .select("id, product_id, user_id, reviewer_name, is_guest, rating, title, comment, created_at")
    .eq("product_id", req.params.productId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const items = data || [];
  const count = items.length;
  const avg = count ? Math.round((items.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : 0;
  // distribution 1..5
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  items.forEach((r) => { dist[r.rating] = (dist[r.rating] || 0) + 1; });

  res.json({ items, summary: { count, avg, dist } });
}));

// POST /api/reviews/:productId  (public, guest-friendly)
router.post("/:productId", optionalAuth, asyncHandler(async (req, res) => {
  const productId = req.params.productId;
  const rating = Number(req.body.rating);
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Rating must be 1–5" });

  let reviewerName;
  let isGuest = false;
  let userId = null;

  if (req.user) {
    userId = req.user.id;
    // use the profile's name if available
    const { data: prof } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).single();
    reviewerName = (req.body.reviewer_name || prof?.full_name || "Customer").trim();
  } else {
    isGuest = true;
    // auto-number guests for THIS product: "Guest N"
    const { count } = await supabaseAdmin
      .from("product_reviews")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId)
      .eq("is_guest", true);
    reviewerName = (req.body.reviewer_name || "").trim() || `Guest ${Number(count || 0) + 1}`;
  }

  const insert = {
    product_id: productId,
    user_id: userId,
    reviewer_name: reviewerName,
    is_guest: isGuest,
    rating,
    title: (req.body.title || "").trim() || null,
    comment: (req.body.comment || "").trim() || null,
  };

  const { data, error } = await supabaseAdmin.from("product_reviews").insert(insert).select().single();
  if (error) throw error;

  // recompute product rating + review count and store on the product (so cards/detail show it)
  const { data: all } = await supabaseAdmin.from("product_reviews").select("rating").eq("product_id", productId);
  const cnt = all?.length || 0;
  const avg = cnt ? Math.round((all.reduce((s, r) => s + r.rating, 0) / cnt) * 10) / 10 : 0;
  await supabaseAdmin.from("products").update({ rating: avg, reviews_count: cnt }).eq("id", productId);

  res.status(201).json(data);
}));

module.exports = router;
