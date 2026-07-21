const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { supabaseAdmin } = require("../config/supabase");
const { loadLiveCampaigns, applySaleToProduct } = require("../utils/salePricing");

const router = express.Router();
const todayStr = () => new Date().toISOString().slice(0, 10);

function coerce(b) {
  const o = { ...b };
  if (o.value !== undefined) o.value = Number(o.value) || 0;
  if (o.enabled !== undefined) o.enabled = !!o.enabled;
  return o;
}

// Apply a campaign discount to a base price
function applyDiscount(price, type, value) {
  if (type === "percent") return Math.max(0, Math.round(price - (price * value) / 100));
  if (type === "fixed") return Math.max(0, Math.round(price - value));
  return price;
}

// Is a campaign live today?
const isLive = (c) => c.enabled && (!c.start_date || todayStr() >= c.start_date) && (!c.end_date || todayStr() <= c.end_date);

// ---- ADMIN: list all campaigns (with their product ids) ----
router.get("/all", authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const { data: camps, error } = await supabaseAdmin
    .from("sale_campaigns").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const { data: links } = await supabaseAdmin.from("sale_campaign_products").select("*");
  const byCamp = new Map();
  (links || []).forEach((l) => { if (!byCamp.has(l.campaign_id)) byCamp.set(l.campaign_id, []); byCamp.get(l.campaign_id).push(l.product_id); });
  res.json({ items: (camps || []).map((c) => ({ ...c, product_ids: byCamp.get(c.id) || [] })) });
}));

// ---- ADMIN: create ----
router.post("/", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { product_ids = [], ...body } = req.body;
  const { data: camp, error } = await supabaseAdmin.from("sale_campaigns").insert(coerce(body)).select().single();
  if (error) throw error;
  if (camp.scope === "products" && product_ids.length) {
    await supabaseAdmin.from("sale_campaign_products").insert(product_ids.map((pid) => ({ campaign_id: camp.id, product_id: pid })));
  }
  res.status(201).json(camp);
}));

// ---- ADMIN: update ----
router.put("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { product_ids, ...body } = req.body;
  const { data: camp, error } = await supabaseAdmin.from("sale_campaigns").update(coerce(body)).eq("id", req.params.id).select().single();
  if (error) throw error;
  if (product_ids !== undefined) {
    await supabaseAdmin.from("sale_campaign_products").delete().eq("campaign_id", req.params.id);
    if (camp.scope === "products" && product_ids.length) {
      await supabaseAdmin.from("sale_campaign_products").insert(product_ids.map((pid) => ({ campaign_id: camp.id, product_id: pid })));
    }
  }
  res.json(camp);
}));

// ---- ADMIN: delete ----
router.delete("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from("sale_campaigns").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

// ---- PUBLIC: products currently on sale (computed) ----
router.get("/products", asyncHandler(async (_req, res) => {
  const { live, linksByCamp } = await loadLiveCampaigns();
  if (!live.length) return res.json({ items: [] });

  const { data: products } = await supabaseAdmin
    .from("products_view").select("*").eq("is_active", true);

  const items = [];
  for (const p of products || []) {
    const before = Number(p.price);
    const out = applySaleToProduct({ ...p }, live, linksByCamp);
    if (out.on_sale && Number(out.price) < before) items.push(out);
  }
  res.json({ items });
}));

module.exports = router;
