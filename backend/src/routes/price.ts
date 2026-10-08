import { Router } from "express";

export const priceRouter = Router();

// Placeholder — wire up CoinGecko / Stellar DEX orderbook in production
priceRouter.get("/:asset", async (req, res) => {
  const { asset } = req.params;
  res.json({
    asset: asset.toUpperCase(),
    price_usd: null,
    source: "not_configured",
    message: "Connect a price oracle in src/routes/price.ts",
  });
});
