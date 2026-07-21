const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();

// GET /api/customers (admin) — all customer profiles with aggregated order stats
router.get("/", authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  // 1) all customer profiles
  const { data: profiles, error: pErr } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email, phone, role, created_at")
    .order("created_at", { ascending: false });
  if (pErr) throw pErr;

  // 2) all orders (id, user, totals, status, date, city/address)
  const { data: orders, error: oErr } = await supabaseAdmin
    .from("orders")
    .select("id, order_code, user_id, customer_name, customer_phone, city, address, total, status, created_at")
    .order("created_at", { ascending: false });
  if (oErr) throw oErr;

  // 3) group orders by user_id
  const byUser = new Map();
  for (const o of orders || []) {
    if (!o.user_id) continue;
    if (!byUser.has(o.user_id)) byUser.set(o.user_id, []);
    byUser.get(o.user_id).push(o);
  }

  const customers = (profiles || [])
    .filter((p) => p.role !== "admin") // show shoppers, not admins
    .map((p) => {
      const list = byUser.get(p.id) || [];
      const paid = list.filter((o) => o.status !== "Cancelled");
      const totalSpent = paid.reduce((s, o) => s + Number(o.total || 0), 0);
      const ordersCount = list.length;
      const lastOrder = list[0]?.created_at || null; // orders already sorted desc
      const avg = paid.length ? Math.round(totalSpent / paid.length) : 0;
      const topOrder = paid.reduce((m, o) => Math.max(m, Number(o.total || 0)), 0);
      const firstOrder = list.length ? list[list.length - 1]?.created_at : null; // list is desc
      const status = totalSpent > 15000 ? "VIP" : ordersCount <= 2 ? "New" : "Active";
      const lastCity = list[0]?.city || null;
      const lastAddress = list[0]?.address || null;
      return {
        id: p.id,
        name: p.full_name || "(no name)",
        email: p.email,
        phone: p.phone || list[0]?.customer_phone || "",
        city: lastCity,
        address: lastAddress,
        joined: p.created_at,
        ordersCount,
        totalSpent,
        avg,
        topOrder,
        lastOrder,
        firstOrder,
        status,
        orders: list.map((o) => ({
          id: o.order_code, total: Number(o.total || 0), date: o.created_at,
          status: o.status,
        })),
      };
    });

  // ---- GUESTS: orders with no user_id, grouped by phone (a guest's identifier) ----
  const guestOrders = (orders || []).filter((o) => !o.user_id);
  const byPhone = new Map();
  for (const o of guestOrders) {
    const key = (o.customer_phone || "").trim() || `order:${o.id}`; // fall back to per-order if no phone
    if (!byPhone.has(key)) byPhone.set(key, []);
    byPhone.get(key).push(o);
  }
  const guests = [...byPhone.entries()].map(([key, list]) => {
    const paid = list.filter((o) => o.status !== "Cancelled");
    const totalSpent = paid.reduce((s, o) => s + Number(o.total || 0), 0);
    const ordersCount = list.length;
    const avg = paid.length ? Math.round(totalSpent / paid.length) : 0;
    const topOrder = paid.reduce((m, o) => Math.max(m, Number(o.total || 0)), 0);
    const lastOrder = list[0]?.created_at || null;          // desc
    const firstOrder = list[list.length - 1]?.created_at || null;
    const status = totalSpent > 15000 ? "VIP" : ordersCount <= 1 ? "New" : "Active";
    return {
      id: `guest:${key}`,
      guest: true,
      name: list[0]?.customer_name || "Guest",
      email: null,
      phone: list[0]?.customer_phone || "",
      city: list[0]?.city || null,
      address: list[0]?.address || null,
      joined: firstOrder,            // guests "join" at their first order
      ordersCount, totalSpent, avg, topOrder,
      lastOrder, firstOrder, status,
      orders: list.map((o) => ({ id: o.order_code, total: Number(o.total || 0), date: o.created_at, status: o.status })),
    };
  });

  res.json({ items: customers, guests });
}));

module.exports = router;
