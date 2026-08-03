const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();
const cleanChart = (body) => ({
  template_name: String(body.template_name || "").trim(),
  heading: String(body.heading || "Size Chart").trim() || "Size Chart",
  note: String(body.note || "").trim(),
  is_active: body.is_active !== false,
  columns: Array.isArray(body.columns) ? body.columns.map((x) => String(x).trim()).filter(Boolean) : [],
  rows: Array.isArray(body.rows) ? body.rows : [],
});

router.get("/", asyncHandler(async (req, res) => {
  let query = supabaseAdmin.from("size_charts").select("id,template_name,heading,note,is_active,columns,rows,created_at").order("template_name");
  if (req.query.all !== "true") query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  res.json({ items: data || [] });
}));

router.post("/", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const chart = cleanChart(req.body);
  if (!chart.template_name) return res.status(400).json({ error: "Template name is required" });
  if (!chart.columns.length || chart.columns[0].toLowerCase() !== "size") return res.status(400).json({ error: "The first column must be Size" });
  const { data, error } = await supabaseAdmin.from("size_charts").insert(chart).select().single();
  if (error) throw error;
  res.status(201).json(data);
}));

router.put("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const chart = cleanChart(req.body);
  if (!chart.template_name || !chart.columns.length) return res.status(400).json({ error: "Template name and columns are required" });
  const { data, error } = await supabaseAdmin.from("size_charts").update({ ...chart, updated_at: new Date().toISOString() }).eq("id", req.params.id).select().single();
  if (error) throw error;
  res.json(data);
}));

router.delete("/:id", authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { count, error: countError } = await supabaseAdmin.from("products").select("id", { count: "exact", head: true }).eq("size_chart_id", req.params.id);
  if (countError) throw countError;
  if (count > 0) return res.status(409).json({ error: "This chart is assigned to products. Deactivate it instead." });
  const { error } = await supabaseAdmin.from("size_charts").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

module.exports = router;
