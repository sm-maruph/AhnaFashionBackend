const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { supabaseAdmin } = require("../config/supabase");
const { validate } = require("../middleware/validate");
const { upload } = require("../middleware/upload");
const { processMany } = require("../utils/image");
const { z } = require("zod");

const router = express.Router();
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// ---- Validation schemas ----
const createCategorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  accent: z.string().min(1),
  image: z.string().optional(),
  is_active: z.coerce.boolean().optional(),
  position: z.coerce.number().int().optional(),
});
const updateCategorySchema = createCategorySchema.partial();

const createGroupSchema = z.object({
  category_id: z.string().uuid(),
  title: z.string().min(1),
  position: z.number().int().optional(),
});
const updateGroupSchema = z.object({
  title: z.string().min(1).optional(),
  position: z.number().int().optional(),
});

const createSubSchema = z.object({
  group_id: z.string().uuid(),        // FK column is group_id (matches your schema/seed)
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  position: z.number().int().optional(),
});

// ---- GET /api/categories (public) — full tree with IDs ----
router.get("/", asyncHandler(async (_req, res) => {
  const { data: categories, error: catErr } = await supabaseAdmin
    .from("categories")
    .select("id, name, slug, accent, image, position")
    .eq("is_active", true)
    .order("position", { ascending: true });
  if (catErr) throw catErr;

  const tree = await Promise.all((categories || []).map(async (cat) => {
    const { data: groups, error: gErr } = await supabaseAdmin
      .from("category_groups")
      .select("id, title, position")
      .eq("category_id", cat.id)
      .order("position", { ascending: true });
    if (gErr) throw gErr;

    const groupsWithSubs = await Promise.all((groups || []).map(async (group) => {
      const { data: subs, error: sErr } = await supabaseAdmin
        .from("subcategories")
        .select("id, name, slug, position")
        .eq("group_id", group.id)
        .order("position", { ascending: true });
      if (sErr) throw sErr;
      return { id: group.id, title: group.title, subcategories: subs || [] };
    }));

    return { id: cat.id, name: cat.name, slug: cat.slug, accent: cat.accent, image: cat.image || null, groups: groupsWithSubs };
  }));

  res.set("Cache-Control", "public, max-age=120");
  res.json(tree); // bare array
}));

// ---- Category CRUD ----
router.post("/", authenticate, requireAdmin, upload.single("image"), validate(createCategorySchema), asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (req.file) {
    const [up] = await processMany("category-images", [req.file], { folder: "categories", thumb: false });
    body.image = up?.url || null;
  }
  const { data, error } = await supabaseAdmin.from("categories").insert(body).select().single();
  if (error) throw error;
  res.status(201).json(data);
}));

router.put("/:id", authenticate, requireAdmin, upload.single("image"), validate(updateCategorySchema), asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (req.file) {
    const [up] = await processMany("category-images", [req.file], { folder: "categories", thumb: false });
    body.image = up?.url || null;
  }
  const { data, error } = await supabaseAdmin.from("categories").update(body).eq("id", req.params.id).select().single();
  if (error) throw error;
  res.json(data);
}));

router.delete("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from("categories").delete().eq("id", req.params.id);
  if (error) throw error;
  res.status(204).send();
}));

// ---- Category Groups ----
router.post("/groups", authenticate, requireAdmin, validate(createGroupSchema), asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("category_groups").insert(req.body).select().single();
  if (error) throw error;
  res.status(201).json(data);
}));

router.put("/groups/:id", authenticate, requireAdmin, validate(updateGroupSchema), asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("category_groups").update(req.body).eq("id", req.params.id).select().single();
  if (error) throw error;
  res.json(data);
}));

router.delete("/groups/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from("category_groups").delete().eq("id", req.params.id);
  if (error) throw error;
  res.status(204).send();
}));

// ---- Subcategories (derives required category_id from the parent group) ----
router.post("/subcategories", authenticate, requireAdmin, validate(createSubSchema), asyncHandler(async (req, res) => {
  const { group_id, name } = req.body;
  const slug = req.body.slug || slugify(name);

  const { data: grp, error: gErr } = await supabaseAdmin
    .from("category_groups").select("category_id").eq("id", group_id).single();
  if (gErr || !grp) return res.status(400).json({ error: "Invalid group_id" });

  const { data, error } = await supabaseAdmin
    .from("subcategories")
    .insert({ group_id, category_id: grp.category_id, name, slug, position: req.body.position ?? 0 })
    .select()
    .single();
  if (error) throw error;
  res.status(201).json(data);
}));

router.delete("/subcategories/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from("subcategories").delete().eq("id", req.params.id);
  if (error) throw error;
  res.status(204).send();
}));

module.exports = router;
