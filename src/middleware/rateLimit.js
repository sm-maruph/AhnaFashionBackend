const rateLimit = require("express-rate-limit");

// General API limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// Stricter limit for auth endpoints (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later." },
});

module.exports = { apiLimiter, authLimiter };
