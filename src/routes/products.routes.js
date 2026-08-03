const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { loadLiveCampaigns, applySaleToProduct } = require("../utils/salePricing");
const { validate } = require("../middleware/validate");
const { requireAdmin, authenticate } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const { processMany, storagePathFromPublicUrl } = require("../utils/image");
const { supabaseAdmin } = require("../config/supabase");
const { productCreate, productUpdate, listQuery } = require("../validators/schemas");

const router = express.Router();
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const asArray = (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
const asJson = (v) => { if (Array.isArray(v)) return v; try { return JSON.parse(v || "[]"); } catch { return []; } };
const withSizeVariants = async (products) => {
  const list = Array.isArray(products) ? products : [products];
  const ids = list.map((p) => p?.id).filter(Boolean);
  if (!ids.length) return products;
  const [{ data, error }, { data: productLinks, error: linkError }] = await Promise.all([
    supabaseAdmin.from("product_size_inventory").select("id,product_id,size_id,stock,size:sizes(id,name,sort_order,is_active)").in("product_id", ids),
    supabaseAdmin.from("products").select("id,size_chart_id").in("id", ids),
  ]);
  if (error) throw error;
  if (linkError) throw linkError;
  const chartIds = [...new Set((productLinks || []).map((p) => p.size_chart_id).filter(Boolean))];
  let charts = [];
  if (chartIds.length) {
    const { data: chartData, error: chartError } = await supabaseAdmin.from("size_charts").select("id,heading,note,columns,rows,is_active").in("id", chartIds);
    if (chartError) throw chartError;
    charts = chartData || [];
  }
  const chartById = new Map(charts.map((c) => [c.id, c]));
  const chartIdByProduct = new Map((productLinks || []).map((p) => [p.id, p.size_chart_id]));
  const byProduct = new Map();
  for (const row of data || []) {
    if (!row.size) continue;
    const item = { id: row.id, size_id: row.size_id, name: row.size.name, stock: Number(row.stock || 0), sort_order: row.size.sort_order };
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, []);
    byProduct.get(row.product_id).push(item);
  }
  list.forEach((p) => {
    p.size_chart_id = chartIdByProduct.get(p.id) || null;
    p.size_chart = chartById.get(p.size_chart_id) || null;
    p.size_variants = (byProduct.get(p.id) || []).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    if (p.size_variants.length) {
      p.sizes = p.size_variants.map((v) => v.name);
      p.stock = p.size_variants.reduce((sum, v) => sum + v.stock, 0);
      p.in_stock = p.stock > 0;
    }
  });
  return products;
};

const saveSizeVariants = async (productId, raw) => {
  if (raw === undefined) return;
  const incoming = asJson(raw).filter((v) => v && (v.size_id || String(v.name || "").trim()));
  const variants = [];
  for (let index = 0; index < incoming.length; index += 1) {
    const variant = incoming[index];
    let sizeId = variant.size_id;
    const name = String(variant.name || "").trim();
    if (!sizeId && name) {
      const { data: existing, error: findError } = await supabaseAdmin.from("sizes").select("id").ilike("name", name).maybeSingle();
      if (findError) throw findError;
      if (existing) sizeId = existing.id;
      else {
        const { data: created, error: createError } = await supabaseAdmin.from("sizes")
          .insert({ name, sort_order: index, is_active: true }).select("id").single();
        if (createError) throw createError;
        sizeId = created.id;
      }
    }
    if (sizeId) variants.push({ size_id: sizeId, stock: Math.max(0, Number(variant.stock) || 0) });
  }
  const { error: deleteError } = await supabaseAdmin.from("product_size_inventory").delete().eq("product_id", productId);
  if (deleteError) throw deleteError;
  if (variants.length) {
    const rows = variants.map((v) => ({ product_id: productId, ...v }));
    const { error } = await supabaseAdmin.from("product_size_inventory").insert(rows);
    if (error) throw error;
    await supabaseAdmin.from("products").update({ stock: rows.reduce((s, v) => s + v.stock, 0) }).eq("id", productId);
  }
};

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
  await withSizeVariants(data || []);
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
  await withSizeVariants(data);
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
      price: b.price, old_price: b.old_price ?? null, stock: b.stock, size_chart_id: b.size_chart_id || null,
      sizes: asArray(b.sizes), colors: asJson(b.colors), tags: asArray(b.tags),
      image: uploaded[0]?.url || null,
    };
    const { data: product, error } = await supabaseAdmin.from("products").insert(insert).select().single();
    if (error) throw error;
    await saveSizeVariants(product.id, b.size_variants);

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
    ["name", "brand", "description", "slug", "category_id", "subcategory_id", "price", "old_price", "stock", "size_chart_id"].forEach((k) => {
      if (b[k] !== undefined) patch[k] = k === "size_chart_id" ? (b[k] || null) : b[k];
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
    await saveSizeVariants(req.params.id, b.size_variants);
    res.json(data);
  })
);

// DELETE /api/products/:id  (admin)
router.delete("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const bucket = "product-images";
  const [
    { data: product, error: productError },
    { data: gallery, error: galleryError },
  ] = await Promise.all([
    supabaseAdmin.from("products").select("id,image").eq("id", req.params.id).maybeSingle(),
    supabaseAdmin.from("product_images").select("url").eq("product_id", req.params.id),
  ]);

  if (productError) throw productError;
  if (galleryError) throw galleryError;
  if (!product) return res.status(404).json({ error: "Product not found" });

  // The cover image is also present in product_images, so deduplicate paths.
  const imageUrls = [product.image, ...(gallery || []).map((image) => image.url)];
  const imagePaths = [...new Set(
    imageUrls.map((url) => storagePathFromPublicUrl(url, bucket)).filter(Boolean)
  )];

  // Remove files first. If Storage fails, keep the product row so deletion can
  // be retried instead of silently leaving orphaned files in the bucket.
  if (imagePaths.length) {
    const { error: storageError } = await supabaseAdmin.storage.from(bucket).remove(imagePaths);
    if (storageError) throw storageError;
  }

  const { error } = await supabaseAdmin.from("products").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true, deletedImages: imagePaths.length });
}));

module.exports = router;
