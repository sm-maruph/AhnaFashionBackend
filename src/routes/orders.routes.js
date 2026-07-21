const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { validate } = require("../middleware/validate");
const { optionalAuth, authenticate, requireAdmin } = require("../middleware/auth");
const { userClient } = require("../utils/userClient");
const { supabaseAdmin } = require("../config/supabase");
const { evaluateCoupon, incrementCouponUsage } = require("../utils/couponPricing");
const { orderSchema } = require("../validators/schemas");

const router = express.Router();
const DELIVERY = { inside_dhaka: 80, outside_dhaka: 120 };

// POST /api/orders  (guest or logged-in) — totals computed SERVER-SIDE (never trust client)
router.post("/", optionalAuth, validate(orderSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const subtotal = b.items.reduce((s, it) => s + Number(it.price) * it.qty, 0);
  let delivery = DELIVERY[b.delivery_zone];

  // Re-validate the coupon SERVER-SIDE and compute the real discount.
  // Never trust a client-sent amount — this is what gets saved on the order.
  let discount = 0;
  let appliedCoupon = null;
  if (b.coupon_code) {
    const cp = await evaluateCoupon(b.coupon_code, subtotal);
    if (cp.valid) {
      discount = cp.discount;
      if (cp.freeShipping) delivery = 0;
      appliedCoupon = cp.coupon;
    }
    // If the coupon is no longer valid we simply ignore it (order still goes through at full price).
  }

  const total = Math.max(0, subtotal + delivery - discount);

  const client = userClient(req.accessToken); // acts as the user (or guest) so RLS applies
  const { data, error } = await client.rpc("place_order", {
    p_user_id: req.user?.id || null,
    p_customer_name: b.customer_name,
    p_customer_phone: b.customer_phone,
    p_address: b.address,
    p_city: b.city || null,
    p_delivery_zone: b.delivery_zone,
    p_subtotal: subtotal,
    p_delivery_charge: delivery,
    p_discount: discount,
    p_total: total,
    p_coupon_code: appliedCoupon ? appliedCoupon.code : null,
    p_payment_method: b.payment_method,
    p_note: b.note || null,
    p_items: b.items,
  });
  if (error) throw error;
  // Coupon consumed — bump its usage counter (best effort)
  if (appliedCoupon) await incrementCouponUsage(appliedCoupon.id);

  res.status(201).json({ order_code: data, subtotal, delivery, discount, total });
}));

// GET /api/orders/track/:code  (public) — single order via secure RPC
router.get("/track/:code", asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc("get_order_by_code", { p_code: req.params.code });
  if (error) throw error;
  if (!data) return res.status(404).json({ error: "Order not found" });
  res.json(data);
}));

// GET /api/orders/mine  (logged-in customer) — their own orders with items
router.get("/mine", authenticate, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(*)")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  res.json({ items: data || [] });
}));

// GET /api/orders  (admin) — list with items
router.get("/", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  res.json({ items: data });
}));

// PATCH /api/orders/:id/status  (admin)
router.patch("/:id/status", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const allowed = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];
  const next = req.body.status;
  if (!allowed.includes(next)) return res.status(400).json({ error: "Invalid status" });

  // read previous status first (to manage stock transitions)
  const { data: prev } = await supabaseAdmin.from("orders").select("status").eq("id", req.params.id).single();
  const wasCancelled = prev?.status === "Cancelled";

  const { data, error } = await supabaseAdmin.from("orders").update({ status: next }).eq("id", req.params.id).select().single();
  if (error) throw error;

  // Stock transitions:
  //  - moving INTO Cancelled  -> restock items (add qty back)
  //  - moving OUT of Cancelled -> re-decrement items (subtract again)
  if (next === "Cancelled" && !wasCancelled) {
    await supabaseAdmin.rpc("restock_order", { p_order_id: req.params.id });
  } else if (wasCancelled && next !== "Cancelled") {
    // re-apply the original deduction
    const { data: items } = await supabaseAdmin.from("order_items").select("product_id, qty").eq("order_id", req.params.id);
    for (const it of items || []) {
      if (!it.product_id) continue;
      const { data: prod } = await supabaseAdmin.from("products").select("stock").eq("id", it.product_id).single();
      const newStock = Math.max(0, Number(prod?.stock || 0) - Number(it.qty || 0));
      await supabaseAdmin.from("products").update({ stock: newStock }).eq("id", it.product_id);
    }
  }

  res.json(data);
}));

module.exports = router;
