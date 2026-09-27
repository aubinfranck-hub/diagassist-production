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
      const query: VehicleSearchQuery = {
        vin: typeof body.vin === "string" ? body.vin : undefined,
        make: typeof body.make === "string" ? body.make : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        year: typeof body.year === "string" || typeof body.year === "number" ? body.year : undefined,
        engine: typeof body.engine === "string" ? body.engine : undefined,
        q: typeof body.q === "string" ? body.q : undefined,
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
