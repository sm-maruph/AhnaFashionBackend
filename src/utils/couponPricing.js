// Shared coupon logic so /api/coupons/validate (checkout preview) and
// POST /api/orders (the saved order) always compute the SAME discount.
// Never trust a client-sent discount — always recompute here.
const { supabaseAdmin } = require("../config/supabase");

/**
 * Validate a coupon code against a subtotal and compute the discount.
 * @returns {Promise<{valid:boolean, error?:string, code?:string, type?:string,
 *                    discount:number, freeShipping:boolean, coupon?:object}>}
 */
async function evaluateCoupon(rawCode, subtotal) {
  const result = { valid: false, discount: 0, freeShipping: false };
  if (!rawCode) return { ...result, error: "No coupon code" };

  const code = String(rawCode).trim().toUpperCase();
  const { data: c } = await supabaseAdmin
    .from("coupons")
    .select("*")
    .eq("code", code)
    .single();

  if (!c || !c.enabled) return { ...result, error: "Invalid coupon" };

  const today = new Date().toISOString().slice(0, 10);
  if (c.start_date && today < c.start_date) return { ...result, error: "Coupon not active yet" };
  if (c.expiry_date && today > c.expiry_date) return { ...result, error: "Coupon expired" };
  if (c.usage_limit && c.used_count >= c.usage_limit) return { ...result, error: "Coupon usage limit reached" };
  if (c.min_order && Number(subtotal) < Number(c.min_order)) {
    return { ...result, error: `Minimum order \u09F3${c.min_order}` };
  }

  let discount = 0;
  let freeShipping = false;

  if (c.type === "percent") {
    discount = Math.round((Number(subtotal) * Number(c.value)) / 100);
    if (c.max_discount) discount = Math.min(discount, Number(c.max_discount));
  } else if (c.type === "fixed") {
    discount = Math.min(Number(c.value), Number(subtotal));
  } else if (c.type === "shipping") {
    freeShipping = true;
  }

  // never discount more than the subtotal
  discount = Math.max(0, Math.min(discount, Number(subtotal)));

  return { valid: true, code, type: c.type, discount, freeShipping, coupon: c };
}

/**
 * Increment a coupon's used_count after an order is successfully placed.
 * Best-effort: never blocks the order if it fails.
 */
async function incrementCouponUsage(couponId) {
  if (!couponId) return;
  try {
    const { data: c } = await supabaseAdmin
      .from("coupons")
      .select("used_count")
      .eq("id", couponId)
      .single();
    const next = Number(c?.used_count || 0) + 1;
    await supabaseAdmin.from("coupons").update({ used_count: next }).eq("id", couponId);
  } catch (e) {
    console.error("[coupon] could not increment used_count:", e.message);
  }
}

module.exports = { evaluateCoupon, incrementCouponUsage };