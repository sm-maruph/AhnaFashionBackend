const test = require("node:test");
const assert = require("node:assert/strict");
const { createProduct } = require("./createProduct");

function database(failure) {
  const rows = new Map();
  const conflict = { code: "23505", message: 'duplicate key violates unique constraint "products_slug_key"', details: 'Key (slug) already exists.' };
  const client = { from: () => ({ insert: (row) => ({ select: () => ({ single: async () => {
    if (failure) return { error: failure };
    if (rows.has(row.slug)) return { error: conflict };
    rows.set(row.slug, row);
    return { data: row };
  } }) }) }) };
  return { client, rows };
}

test("concurrent products with identical names retain their names and get unique URLs", async () => {
  const { client, rows } = database();
  const products = await Promise.all(Array.from({ length: 3 }, () => createProduct(client, { name: "Classic Shirt", price: 950 })));
  assert.equal(products[0].slug, "classic-shirt");
  assert.equal(rows.size, 3);
  products.forEach((p) => {
    assert.equal(p.name, "Classic Shirt");
    assert.equal(p.price, 950);
  });
});

test("names without Latin characters get nonempty unique URLs", async () => {
  const { client } = database();
  const first = await createProduct(client, { name: "শার্ট" });
  const second = await createProduct(client, { name: "শার্ট" });
  assert.equal(first.slug, "product");
  assert.notEqual(first.slug, second.slug);
});

test("explicit slugs remain intact unless already used", async () => {
  const { client } = database();
  const first = await createProduct(client, { name: "Shirt", slug: "custom" });
  const second = await createProduct(client, { name: "Shirt", slug: "custom" });
  assert.equal(first.slug, "custom");
  assert.match(second.slug, /^custom-/);
});

test("unrelated database errors are not retried or hidden", async () => {
  const failure = { code: "23505", message: "duplicate key: products_sku_key" };
  const { client } = database(failure);
  await assert.rejects(createProduct(client, { name: "Shirt" }), (error) => error === failure);
});

test("repeated slug conflicts end with a useful error", async () => {
  const { client } = database({ code: "23505", details: "Key (slug) already exists." });
  await assert.rejects(createProduct(client, { name: "Shirt" }), { status: 409 });
});
