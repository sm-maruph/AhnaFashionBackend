// Validate req[source] against a zod schema; replace it with the parsed (coerced) data.
const validate = (schema, source = "body") => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: result.error.flatten().fieldErrors,
    });
  }
  req[source] = result.data;
  next();
};
module.exports = { validate };
