const { z } = require("zod");

// Coerce helps with multipart/form-data (everything arrives as strings).
const num = z.coerce.number();
const optNum = z.coerce.number().optional();

const productCreate = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().max(120).optional().default(""),
  description: z.string().max(5000).optional().default(""),
  slug: z.string().max(220).optional(),
  category_id: z.string().uuid().optional().nullable(),
  subcategory_id: z.string().uuid().optional().nullable(),
  price: num.nonnegative(),
  old_price: optNum,
  stock: z.coerce.number().int().nonnegative().default(0),
  sizes: z.union([z.array(z.string()), z.string()]).optional(),   // CSV or array
  colors: z.union([z.array(z.any()), z.string()]).optional(),     // JSON string or array
  tags: z.union([z.array(z.string()), z.string()]).optional(),
});

const productUpdate = productCreate.partial();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(24),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  search: z.string().max(120).optional(),
  sort: z.enum(["newest", "price-asc", "price-desc", "rating"]).default("newest"),
});

const registerSchema = z.object({
  full_name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(6).max(72),
  phone: z.string().max(30).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const orderSchema = z.object({
  customer_name: z.string().min(1).max(120),
  customer_phone: z.string().min(6).max(30),
  address: z.string().min(3).max(400),
  city: z.string().max(80).optional(),
  delivery_zone: z.enum(["inside_dhaka", "outside_dhaka"]),
  payment_method: z.enum(["cod", "bkash", "nagad", "sslcommerz"]),
  coupon_code: z.string().max(40).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid().nullable().optional(),
        name: z.string().min(1),
        image: z.string().url().nullable().optional(),
        price: num.nonnegative(),
        size: z.string().nullable().optional(),
        color: z.string().nullable().optional(),
        qty: z.coerce.number().int().min(1),
      })
    )
    .min(1),
});

const couponValidateSchema = z.object({
  code: z.string().min(1).max(40),
  subtotal: num.nonnegative(),
});

module.exports = {
  productCreate, productUpdate, listQuery,
  registerSchema, loginSchema, orderSchema, couponValidateSchema,
};
