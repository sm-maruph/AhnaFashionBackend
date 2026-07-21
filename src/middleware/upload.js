const multer = require("multer");

// Keep files in memory so sharp can process them before they ever touch storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 8 }, // 8MB each, up to 8 files
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|avif|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

module.exports = { upload };
