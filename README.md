# RAINZLIFESTYLE API (Express + Supabase)

Backend that serves the React storefront and admin panel. Talks to Supabase
Postgres (RLS) and Storage. Optimizes images (WebP) before storing.

## Setup
1. `cp .env.example .env` and fill in values from Supabase → Project Settings → API:
   - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
   - CORS_ORIGIN = http://localhost:3000 (your CRA dev URL)
2. `npm install`
3. `npm run dev`  → http://localhost:5000  (health: /health)

## Security model
- Service-role key lives ONLY here (never in the browser).
- Every request's Supabase JWT is verified locally (middleware/auth.js).
- Admin routes check `profiles.role = 'admin'`.
- helmet, CORS allow-list, rate limiting, zod validation, multer file limits.
- Order totals + coupon discounts are computed server-side (client values ignored).

## Images (fast loading)
- Uploads kept in memory → sharp resizes (max 1200px) → WebP @ ~78% quality.
- Stored with `Cache-Control: 1 year immutable` so the CDN serves them fast.

## Endpoints (so far)
- Auth:      POST /api/auth/register, POST /api/auth/login, GET /api/auth/me
- Products:  GET /api/products, GET /api/products/:slug,
             POST/PUT/DELETE (admin, multipart `images[]`)
- Categories:GET /api/categories, admin POST/PUT/DELETE
- Orders:    POST /api/orders (guest/user), GET /api/orders/track/:code,
             GET /api/orders (admin), PATCH /api/orders/:id/status (admin)
- Coupons:   POST /api/coupons/validate, admin CRUD
- Settings:  GET /api/settings, PUT /api/settings (admin)

## Next to add (same patterns)
sale, customers, stores, banners/collections, product reviews, newsletter.
