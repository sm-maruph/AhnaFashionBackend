const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { validate } = require("../middleware/validate");
const { authenticate } = require("../middleware/auth");
const { supabasePublic, supabaseAdmin } = require("../config/supabase");
const { registerSchema, loginSchema } = require("../validators/schemas");

const router = express.Router();

// POST /api/auth/register
router.post("/register", validate(registerSchema), asyncHandler(async (req, res) => {
  const { email, password, full_name, phone } = req.body;
  const { data, error } = await supabasePublic.auth.signUp({
    email, password, options: { data: { full_name } },
  });
  if (error) return res.status(400).json({ error: error.message });
  // store phone on profile (created by DB trigger)
  if (phone && data.user) await supabaseAdmin.from("profiles").update({ phone, full_name }).eq("id", data.user.id);
  res.status(201).json({ user: data.user, session: data.session });
}));

// POST /api/auth/login
router.post("/login", validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password });
  if (error) {
    console.log("LOGIN ERROR →", error.message, "| status:", error.status); // check backend terminal
    return res.status(401).json({ error: "Invalid email or password" });
  }
  res.json({ user: data.user, session: data.session });
}));

// GET /api/auth/me  (current profile)
router.get("/me", authenticate, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("profiles").select("*").eq("id", req.user.id).single();
  if (error) throw error;
  res.json(data);
}));

module.exports = router;
