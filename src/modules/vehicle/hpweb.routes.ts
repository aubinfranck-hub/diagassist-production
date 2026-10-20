import type { Express, Request, Response } from "express";
import { searchHpWeb } from "./hpwebClient";
import type { VehicleSearchQuery } from "./vehicleContext";

export function registerHpWebRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: () => void) => void,
): void {
  app.post("/api/vehicle/hp-web/search", requireAuth, async (req: any, res: any) => {
    try {
      const body = req.body || {};
      // Champs bornés : le gateway est payant et le cache est en mémoire.
      const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
      const query: VehicleSearchQuery = {
        vin: text(body.vin, 17),
        make: text(body.make, 40),
        model: text(body.model, 60),
        year: typeof body.year === "number" && Number.isInteger(body.year) && body.year > 1950 && body.year < 2100 ? body.year : text(body.year, 4),
        engine: text(body.engine, 60),
        q: text(body.q, 120),
      };

      if (!query.vin && !query.make && !query.model && !query.year && !query.engine && !query.q) {
        return res.status(400).json({ success: false, message: "Critère de recherche requis." });
      }

      const results = await searchHpWeb(query);
      return res.json({ success: true, results });
    } catch (error: any) {
      console.error("[HP-WEB] Recherche:", error?.message || error);
      return res.status(502).json({
        success: false,
        message: "La base technique HP-Web est momentanément indisponible.",
      });
    }
  });
}
