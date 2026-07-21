// Optimize images BEFORE storing: resize to a sane max width, convert to WebP,
// strip metadata. This keeps stored files small so the storefront loads fast.
// Also produces a small thumbnail for list/grid views.
const sharp = require("sharp");
const crypto = require("crypto");
const { supabaseAdmin } = require("../config/supabase");

const MAIN_WIDTH = 1600;  // product main image cap (raised from 1200)
const THUMB_WIDTH = 400;  // grid thumbnail
const QUALITY = 86;       // WebP quality — crisp, still reasonably small (raised from 78)

async function toWebp(buffer, width, quality = QUALITY) {
  return sharp(buffer)
    .rotate() // respect EXIF orientation
    .resize({ width, withoutEnlargement: true })
    .webp({ quality, effort: 5 })
    .toBuffer();
}

function randomName(folder, suffix = "") {
  const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  return `${folder ? folder.replace(/\/+$/, "") + "/" : ""}${id}${suffix}.webp`;
}

async function putObject(bucket, path, buffer) {
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, buffer, {
    contentType: "image/webp",
    upsert: false,
    cacheControl: "public, max-age=31536000, immutable", // 1 year, immutable -> CDN cached
  });
  if (error) throw error;
  return supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// Process a single file buffer -> { url, thumbUrl, bytes }
// opts: { folder, main, thumb, width, quality, thumbWidth, thumbQuality }
async function processAndUpload(bucket, fileBuffer, opts = {}) {
  const {
    folder = "",
    main = true,
    thumb = true,
    width = MAIN_WIDTH,
    quality = QUALITY,
    thumbWidth = THUMB_WIDTH,
    thumbQuality = 72,
  } = opts;

  const out = {};
  if (main) {
    const buf = await toWebp(fileBuffer, width, quality);
    out.url = await putObject(bucket, randomName(folder), buf);
    out.bytes = buf.length;
  }
  if (thumb) {
    const tbuf = await toWebp(fileBuffer, thumbWidth, thumbQuality);
    out.thumbUrl = await putObject(bucket, randomName(folder, "-thumb"), tbuf);
  }
  return out;
}

// Process many files (e.g. product gallery). Returns array of { url, thumbUrl }.
async function processMany(bucket, files, opts = {}) {
  return Promise.all(files.map((f) => processAndUpload(bucket, f.buffer, opts)));
}

module.exports = { processAndUpload, processMany, toWebp };