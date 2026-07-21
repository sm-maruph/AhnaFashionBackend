const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { loadLiveCampaigns, applySaleToProduct } = require("../utils/salePricing");
const { validate } = require("../middleware/validate");
const { requireAdmin, authenticate } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const { processMany } = require("../utils/image");
const { supabaseAdmin } = require("../config/supabase");
const { productCreate, productUpdate, listQuery } = require("../validators/schemas");

const router = express.Router();
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const asArray = (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
const asJson = (v) => { if (Array.isArray(v)) return v; try { return JSON.parse(v || "[]"); } catch { return []; } };

// GET /api/products  (public, paginated, filtered) — selects only needed columns
router.get("/", validate(listQuery, "query"), asyncHandler(async (req, res) => {
  const { page, pageSize, category, subcategory, search, sort } = req.query;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabaseAdmin
    .from("products_view")
    .select("id,slug,name,brand,price,old_price,image,images,rating,reviews_count,category_id,subcategory_id,category_name,category_slug,subcategory_name,subcategory_slug,in_stock,sizes,colors", { count: "exact" })
    .eq("is_active", true);

  if (category) q = q.eq("category_slug", category);
  if (subcategory) q = q.eq("subcategory_slug", subcategory);
  if (search) q = q.ilike("name", `%${search}%`);
  if (sort === "price-asc") q = q.order("price", { ascending: true });
  else if (sort === "price-desc") q = q.order("price", { ascending: false });
  else if (sort === "rating") q = q.order("rating", { ascending: false });
  else q = q.order("created_at", { ascending: false });

  const { data, count, error } = await q.range(from, to);
  if (error) throw error;
  const { live, linksByCamp } = await loadLiveCampaigns();
  const items = (data || []).map((p) => applySaleToProduct(p, live, linksByCamp));
  res.json({ items, total: count, page, pageSize });
}));

// GET /api/products/:slug  (public)
router.get("/:slug", asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("products_view")
    .select("*")
    .eq("slug", req.params.slug)
    .eq("is_active", true)
    .single();
  if (error || !data) return res.status(404).json({ error: "Product not found" });
  const { live, linksByCamp } = await loadLiveCampaigns();
  res.json(applySaleToProduct(data, live, linksByCamp));
}));

// POST /api/products  (admin) — multipart with images[]
router.post("/", authenticate, requireAdmin, upload.array("images", 8),
  validate(productCreate), asyncHandler(async (req, res) => {
    const b = req.body;
    // 1) optimize + upload images to storage
    let uploaded = [];
    if (req.files?.length) uploaded = await processMany("product-images", req.files, { folder: "products", thumb: false });

    // 2) insert product
    const insert = {
      name: b.name, brand: b.brand, description: b.description,
      slug: b.slug || slugify(b.name),
      category_id: b.category_id || null, subcategory_id: b.subcategory_id || null,
      price: b.price, old_price: b.old_price ?? null, stock: b.stock,
      sizes: asArray(b.sizes), colors: asJson(b.colors), tags: asArray(b.tags),
      image: uploaded[0]?.url || null,
    };
    const { data: product, error } = await supabaseAdmin.from("products").insert(insert).select().single();
    if (error) throw error;

    // 3) gallery rows
    if (uploaded.length) {
      const rows = uploaded.map((u, i) => ({ product_id: product.id, url: u.url, position: i, is_cover: i === 0 }));
      await supabaseAdmin.from("product_images").insert(rows);
    }
    res.status(201).json(product);
  })
);

// PUT /api/products/:id  (admin) — update fields, optionally append images
router.put("/:id", authenticate, requireAdmin, upload.array("images", 8),
  validate(productUpdate), asyncHandler(async (req, res) => {
    const b = req.body;
    const patch = {};
    ["name", "brand", "description", "slug", "category_id", "subcategory_id", "price", "old_price", "stock"].forEach((k) => {
      if (b[k] !== undefined) patch[k] = b[k];
    });
    if (b.sizes !== undefined) patch.sizes = asArray(b.sizes);
    if (b.colors !== undefined) patch.colors = asJson(b.colors);
    if (b.tags !== undefined) patch.tags = asArray(b.tags);

    if (req.files?.length) {
      const uploaded = await processMany("product-images", req.files, { folder: "products", thumb: false });
      const { data: existing } = await supabaseAdmin.from("product_images").select("id").eq("product_id", req.params.id);
      const base = existing?.length || 0;
      const rows = uploaded.map((u, i) => ({ product_id: req.params.id, url: u.url, position: base + i, is_cover: base === 0 && i === 0 }));
      await supabaseAdmin.from("product_images").insert(rows);
      if (base === 0 && uploaded[0]) patch.image = uploaded[0].url;
    }

    const { data, error } = await supabaseAdmin.from("products").update(patch).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  })
);

// DELETE /api/products/:id  (admin)
router.delete("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from("products").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

module.exports = router;