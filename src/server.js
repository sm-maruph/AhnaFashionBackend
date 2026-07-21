require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");

const { apiLimiter, authLimiter } = require("./middleware/rateLimit");
const { notFound, errorHandler } = require("./middleware/error");
const routes = require("./routes");

const app = express();
app.set("trust proxy", 1); // correct client IPs behind a proxy (for rate limiting)

// --- Security headers ---
app.use(helmet());

// --- CORS: only allow your frontend origin(s) ---
const origins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

// --- Performance: gzip responses ---
app.use(compression());

// --- Body parsing (JSON routes). Multipart handled per-route by multer. ---
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// --- Logging ---
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// --- Health check ---
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// --- Rate limiting ---
app.use("/api/auth", authLimiter); // stricter on auth
app.use("/api", apiLimiter);

// --- Routes ---
app.use("/api", routes);

// --- 404 + error handler (last) ---
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
