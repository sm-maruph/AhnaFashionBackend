const { randomUUID } = require("node:crypto");

const slugify = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function createProduct(client, values) {
  const base = values.slug || slugify(values.name) || "product";
  let slug = base;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await client.from("products").insert({ ...values, slug }).select().single();
    if (!error) return data;
    // Retry only slug collisions; unrelated database failures must surface.
    const isSlugConflict = error.code === "23505" &&
      /\bslug\b|products_slug/i.test(`${error.message || ""} ${error.details || ""}`);
    if (!isSlugConflict) throw error;
    // The insert itself arbitrates concurrent requests with the same name.
    slug = `${base.slice(0, 183)}-${randomUUID()}`;
  }
  const error = new Error("Could not generate a unique product URL. Please try again.");
  error.status = 409;
  throw error;
}

module.exports = { createProduct };
