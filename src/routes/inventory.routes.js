const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();

// GET /api/inventory  (admin) — products with stock + order stats per product
router.get("/", authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  // 1) products — try with threshold column; fall back if it doesn't exist yet
  let products, pErr;
  ({ data: products, error: pErr } = await supabaseAdmin
    .from("products")
    .select("id, name, image, price, stock, low_stock_threshold, category_id")
    .order("stock", { ascending: true }));
  if (pErr) {
    // likely the low_stock_threshold column hasn't been added — retry without it
    ({ data: products, error: pErr } = await supabaseAdmin
      .from("products")
      .select("id, name, image, price, stock, category_id")
      .order("stock", { ascending: true }));
    if (pErr) throw pErr;
    (products || []).forEach((p) => { p.low_stock_threshold = 5; });
  }

  // 2) order_items + a separate map of order_id -> status (avoids nested-join FK issues)
  const { data: items, error: iErr } = await supabaseAdmin
    .from("order_items")
    .select("product_id, qty, order_id");
  if (iErr) throw iErr;

  const { data: orderRows } = await supabaseAdmin.from("orders").select("id, status");
  const statusByOrder = new Map((orderRows || []).map((o) => [o.id, o.status]));

  // tally per product
  const stat = new Map(); // pid -> { byStatus:{}, orderedQty, cancelledQty, activeQty }
  for (const it of items || []) {
    if (!it.product_id) continue;
    const st = statusByOrder.get(it.order_id) || "Pending";
    const qty = Number(it.qty || 0);
    if (!stat.has(it.product_id)) stat.set(it.product_id, { byStatus: {}, orderedQty: 0, cancelledQty: 0, activeQty: 0 });
    const s = stat.get(it.product_id);
    s.byStatus[st] = (s.byStatus[st] || 0) + qty;
    s.orderedQty += qty;
    if (st === "Cancelled") s.cancelledQty += qty;
    else s.activeQty += qty; // counts toward "sold/committed"
  }

  const rows = (products || []).map((p) => {
    const s = stat.get(p.id) || { byStatus: {}, orderedQty: 0, cancelledQty: 0, activeQty: 0 };
    const threshold = p.low_stock_threshold ?? 5;
    const stock = Number(p.stock || 0);
    let level = "ok";
    if (stock <= 0) level = "out";
    else if (stock <= threshold) level = "low";
    // restock suggestion: bring back up to ~3x threshold, but at least recent demand
    const suggestedRestock = level === "ok" ? 0 : Math.max(threshold * 3 - stock, s.activeQty, threshold);
    return {
      id: p.id, name: p.name, image: p.image, price: Number(p.price || 0),
      stock, threshold, level,
      orderedQty: s.orderedQty, activeQty: s.activeQty, cancelledQty: s.cancelledQty,
      byStatus: s.byStatus, suggestedRestock,
    };
  });

  res.json({ items: rows });
}));

// PATCH /api/inventory/:id  (admin) — set absolute stock and/or threshold
router.patch("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.stock !== undefined) patch.stock = Math.max(0, parseInt(req.body.stock, 10) || 0);
  if (req.body.low_stock_threshold !== undefined) patch.low_stock_threshold = Math.max(0, parseInt(req.body.low_stock_threshold, 10) || 0);
  const { data, error } = await supabaseAdmin.from("products").update(patch).eq("id", req.params.id).select().single();
  if (error) throw error;
  res.json(data);
}));

// POST /api/inventory/:id/restock  (admin) — add to stock
router.post("/:id/restock", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const add = Math.max(0, parseInt(req.body.amount, 10) || 0);
  const { data: prod, error: e1 } = await supabaseAdmin.from("products").select("stock").eq("id", req.params.id).single();
  if (e1) throw e1;
  const newStock = Number(prod?.stock || 0) + add;
  const { data, error } = await supabaseAdmin.from("products").update({ stock: newStock }).eq("id", req.params.id).select().single();
  if (error) throw error;
  res.json(data);
}));

module.exports = router;
