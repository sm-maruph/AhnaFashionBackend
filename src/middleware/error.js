function notFound(_req, res) {
  res.status(404).json({ error: "Route not found" });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  // Multer + known errors
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Image too large (max 8MB)" });
  if (err.message === "Only image files are allowed") return res.status(415).json({ error: err.message });

  const status = err.status || 500;
  const message = status === 500 ? "Internal server error" : err.message;
  if (status === 500) console.error(err);
  res.status(status).json({ error: message });
}

module.exports = { notFound, errorHandler };
