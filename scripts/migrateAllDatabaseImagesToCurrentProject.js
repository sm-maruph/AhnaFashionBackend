const { supabaseAdmin } = require("../src/config/supabase");

const TARGET_HOST = new URL(process.env.SUPABASE_URL).host;
const STORAGE_PREFIX = "/storage/v1/object/public/";
const IMAGE_COLUMNS = [
  { table: "products", column: "image" },
  { table: "product_images", column: "url" },
  { table: "categories", column: "image" },
  { table: "banners", column: "image" },
  { table: "collections", column: "image" },
  { table: "hero_slides", column: "image" },
  { table: "store_settings", column: "logo" },
  { table: "stores", column: "image" },
  { table: "order_items", column: "image" },
];

function storageObject(publicUrl) {
  const parsed = new URL(publicUrl);
  const prefixIndex = parsed.pathname.indexOf(STORAGE_PREFIX);
  if (prefixIndex === -1) return null;

  const remainder = parsed.pathname.slice(prefixIndex + STORAGE_PREFIX.length);
  const slashIndex = remainder.indexOf("/");
  if (slashIndex < 1) throw new Error(`Invalid Supabase Storage URL: ${publicUrl}`);

  const bucket = decodeURIComponent(remainder.slice(0, slashIndex));
  const path = decodeURIComponent(remainder.slice(slashIndex + 1));
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "." || part === "..")) {
    throw new Error(`Unsafe Storage path in URL: ${publicUrl}`);
  }
  return { bucket, path };
}

async function loadOldProjectRows() {
  const rows = [];
  for (const spec of IMAGE_COLUMNS) {
    const { data, error } = await supabaseAdmin
      .from(spec.table)
      .select(`id,${spec.column}`)
      .not(spec.column, "is", null);
    if (error) throw error;

    for (const row of data) {
      const oldUrl = row[spec.column];
      const parsed = new URL(oldUrl);
      if (parsed.host === TARGET_HOST) continue;

      const object = storageObject(oldUrl);
      // Preserve intentional third-party images; migrate Supabase Storage URLs.
      if (object) rows.push({ ...spec, id: row.id, oldUrl, ...object });
    }
  }
  return rows;
}

async function targetFileExists(bucket, path) {
  const url = supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  const response = await fetch(url, { method: "HEAD" });
  return response.ok;
}

async function main() {
  const rows = await loadOldProjectRows();
  if (!rows.length) {
    console.log("All database-managed images already point to the current Supabase project.");
    return;
  }

  const objects = new Map();
  for (const row of rows) objects.set(`${row.bucket}\0${row.path}`, row);

  const replacements = new Map();
  const uploaded = [];
  const updated = [];
  console.log(`Migrating ${objects.size} unique Storage objects used by ${rows.length} rows...`);

  try {
    let index = 0;
    for (const row of objects.values()) {
      index += 1;
      if (!(await targetFileExists(row.bucket, row.path))) {
        const response = await fetch(row.oldUrl);
        if (!response.ok) throw new Error(`Download failed (${response.status}): ${row.oldUrl}`);

        const bytes = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get("content-type") || "application/octet-stream";
        const { error } = await supabaseAdmin.storage.from(row.bucket).upload(row.path, bytes, {
          contentType,
          upsert: false,
          cacheControl: "public, max-age=31536000, immutable",
        });
        if (error) throw error;
        uploaded.push({ bucket: row.bucket, path: row.path });
      }

      const newUrl = supabaseAdmin.storage.from(row.bucket).getPublicUrl(row.path).data.publicUrl;
      replacements.set(`${row.bucket}\0${row.path}`, newUrl);
      console.log(`Prepared ${index}/${objects.size}: ${row.bucket}/${row.path}`);
    }

    for (const row of rows) {
      const newUrl = replacements.get(`${row.bucket}\0${row.path}`);
      const { error } = await supabaseAdmin
        .from(row.table)
        .update({ [row.column]: newUrl })
        .eq("id", row.id);
      if (error) throw error;
      updated.push(row);
    }
  } catch (error) {
    for (const row of updated.reverse()) {
      await supabaseAdmin.from(row.table).update({ [row.column]: row.oldUrl }).eq("id", row.id);
    }
    for (const file of uploaded.reverse()) {
      await supabaseAdmin.storage.from(file.bucket).remove([file.path]);
    }
    throw error;
  }

  console.log(
    `Migration complete: ${uploaded.length} files uploaded, ` +
    `${objects.size - uploaded.length} existing files reused, and ${rows.length} rows updated.`
  );
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
});
