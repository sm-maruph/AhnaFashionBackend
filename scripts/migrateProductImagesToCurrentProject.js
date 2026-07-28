const { supabaseAdmin } = require("../src/config/supabase");

const BUCKET = "product-images";
const STORAGE_MARKER = `/storage/v1/object/public/${BUCKET}/`;
const TARGET_HOST = new URL(process.env.SUPABASE_URL).host;

function objectPath(url) {
  const parsed = new URL(url);
  const markerIndex = parsed.pathname.indexOf(STORAGE_MARKER);
  if (markerIndex === -1) throw new Error(`Not a ${BUCKET} public URL: ${url}`);

  const path = decodeURIComponent(parsed.pathname.slice(markerIndex + STORAGE_MARKER.length));
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "." || part === "..")) {
    throw new Error(`Unsafe Storage path in URL: ${url}`);
  }
  return path;
}

async function loadRows() {
  const [
    { data: products, error: productsError },
    { data: gallery, error: galleryError },
  ] = await Promise.all([
    supabaseAdmin.from("products").select("id,image").not("image", "is", null),
    supabaseAdmin.from("product_images").select("id,url").not("url", "is", null),
  ]);

  if (productsError) throw productsError;
  if (galleryError) throw galleryError;

  return [
    ...products.map((row) => ({ table: "products", id: row.id, column: "image", oldUrl: row.image })),
    ...gallery.map((row) => ({ table: "product_images", id: row.id, column: "url", oldUrl: row.url })),
  ].filter((row) => new URL(row.oldUrl).host !== TARGET_HOST);
}

async function main() {
  const rows = await loadRows();
  if (!rows.length) {
    console.log("All product image URLs already point to the current Supabase project.");
    return;
  }

  const urls = [...new Set(rows.map((row) => row.oldUrl))];
  const replacements = new Map();
  const uploadedPaths = [];
  const updatedRows = [];

  console.log(`Migrating ${urls.length} unique files used by ${rows.length} database rows...`);

  try {
    for (const [index, oldUrl] of urls.entries()) {
      const path = objectPath(oldUrl);
      const response = await fetch(oldUrl);
      if (!response.ok) throw new Error(`Download failed (${response.status}): ${oldUrl}`);

      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "image/webp";
      const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
        contentType,
        upsert: false,
        cacheControl: "public, max-age=31536000, immutable",
      });
      if (uploadError) throw uploadError;

      uploadedPaths.push(path);
      const newUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      replacements.set(oldUrl, newUrl);
      console.log(`Uploaded ${index + 1}/${urls.length}: ${path}`);
    }

    for (const row of rows) {
      const newUrl = replacements.get(row.oldUrl);
      const { error: updateError } = await supabaseAdmin
        .from(row.table)
        .update({ [row.column]: newUrl })
        .eq("id", row.id);
      if (updateError) throw updateError;
      updatedRows.push(row);
    }
  } catch (error) {
    // Restore any rows already changed before removing the newly uploaded files.
    for (const row of updatedRows.reverse()) {
      await supabaseAdmin.from(row.table).update({ [row.column]: row.oldUrl }).eq("id", row.id);
    }
    if (uploadedPaths.length) await supabaseAdmin.storage.from(BUCKET).remove(uploadedPaths);
    throw error;
  }

  console.log(`Migration complete: ${urls.length} files uploaded and ${rows.length} rows updated.`);
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
});
