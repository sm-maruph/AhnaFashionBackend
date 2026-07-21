const express = require("express");
const router = express.Router();

router.use("/products", require("./products.routes"));
router.use("/categories", require("./categories.routes"));
router.use("/orders", require("./orders.routes"));
router.use("/coupons", require("./coupons.routes"));
router.use("/auth", require("./auth.routes"));
router.use("/settings", require("./settings.routes"));
router.use("/cart", require("./cart.routes"));
router.use("/wishlist", require("./wishlist.routes"));
router.use("/banners", require("./banners.routes"));
router.use("/collections", require("./collections.routes"));
router.use("/customers", require("./customers.routes"));
router.use("/hero", require("./hero.routes"));
router.use("/reviews", require("./reviews.routes"));   // <-- ADD THIS
router.use("/sale", require("./sale.routes"));         // <-- ADD THIS
router.use("/stores", require("./stores.routes"));
router.use("/inventory", require("./inventory.routes")); // <-- ADD THIS

module.exports = router;
