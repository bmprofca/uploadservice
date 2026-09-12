function getConfiguredKeys() {
  const raw = process.env.API_KEYS || process.env.API_KEY || "";
  return raw
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export function requireApiKey(req, res, next) {
  const configuredKeys = getConfiguredKeys();

  if (!configuredKeys.length) {
    return res.status(500).json({
      success: false,
      error: "API keys are not configured on the server",
    });
  }

  const providedKey = req.get("key");

  if (!providedKey || !configuredKeys.includes(providedKey)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized. Provide a valid "key" header.',
    });
  }

  return next();
}
