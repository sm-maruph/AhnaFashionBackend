// Shared sale-campaign pricing. Computes the best active discount for products.
const { supabaseAdmin } = require("../config/supabase");

const todayStr = () => new Date().toISOString().slice(0, 10);
const isLive = (c) =>
  c.enabled &&
  (!c.start_date || todayStr() >= c.start_date) &&
  (!c.end_date || todayStr() <= c.end_date);

function applyDiscount(price, type, value) {
  if (type === "percent") return Math.max(0, Math.round(price - (price * value) / 100));
  if (type === "fixed") return Math.max(0, Math.round(price - value));
  return price;
}

// Load live campaigns + the product links for product-scoped ones. Call once per request.
async function loadLiveCampaigns() {
  const { data: camps } = await supabaseAdmin.from("sale_campaigns").select("*");
  const live = (camps || []).filter(isLive);

  const prodScopeIds = live.filter((c) => c.scope === "products").map((c) => c.id);
  const linksByCamp = new Map();
  if (prodScopeIds.length) {
    const { data: links } = await supabaseAdmin
      .from("sale_campaign_products").select("*").in("campaign_id", prodScopeIds);
    (links || []).forEach((l) => {
      if (!linksByCamp.has(l.campaign_id)) linksByCamp.set(l.campaign_id, new Set());
      linksByCamp.get(l.campaign_id).add(l.product_id);
    });
  }
  return { live, linksByCamp };
}

// Given a product row (from products_view: has category_id/subcategory_id/price)
// return { salePrice, oldPrice, campaign, endDate } or null if no active discount.
function bestSaleFor(product, live, linksByCamp) {
  let best = null;
  for (const c of live) {
    let matches = false;
    if (c.scope === "sitewide") matches = true;
    else if (c.scope === "category") matches = c.category_id && product.category_id === c.category_id;
    else if (c.scope === "subcategory") matches = c.subcategory_id && product.subcategory_id === c.subcategory_id;
    else if (c.scope === "products") matches = linksByCamp.get(c.id)?.has(product.id);
    if (!matches) continue;
    const sp = applyDiscount(Number(product.price), c.discount_type, Number(c.value));
    if (best === null || sp < best.salePrice) {
      best = { salePrice: sp, oldPrice: Number(product.price), campaign: c.name, endDate: c.end_date || null };
    }
  }
  return best && best.salePrice < Number(product.price) ? best : null;
}

// Mutate a single product object to reflect the active sale (price/old_price/sale_*).
function applySaleToProduct(product, live, linksByCamp) {
  const best = bestSaleFor(product, live, linksByCamp);
  if (best) {
    product.old_price = best.oldPrice;
    product.price = best.salePrice;
    product.sale_campaign = best.campaign;
    product.sale_ends = best.endDate;
    product.on_sale = true;
  }
  return product;
}

module.exports = { loadLiveCampaigns, bestSaleFor, applySaleToProduct, applyDiscount, isLive };
