import type { Express, Request, Response } from "express";
import type { GuideRequest } from "./guideTypes";
import { buildGuideContent } from "./guideContent";
import { guideFileName, renderGuidePdf } from "./guidePdf";

const PREMIUM_PLANS = ["free_trial", "premium", "payg_active"];
const field = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim().slice(0, max) : "");

export function registerGuideRoutes(
  app: Express,
  deps: {
    requireAuth: (req: Request, res: Response, next: () => void) => void;
    limiter: any;
    generate: (contents: any, config: any) => Promise<any>;
  },
): void {
  // POST /api/guide/pdf { make, model, year?, equipment?, topic? } -> application/pdf
  app.post("/api/guide/pdf", deps.limiter, deps.requireAuth, async (req: any, res: any) => {
    try {
      if (!PREMIUM_PLANS.includes(req.session?.plan)) {
        return res.status(403).json({ success: false, message: "Cette fonctionnalité nécessite un forfait actif." });
      }
      const body = req.body || {};
      const year = typeof body.year === "number" ? String(body.year) : field(body.year, 9);
      // Le diagnostic expose le véhicule en texte libre ("Honda CR-V 2019") : on le découpe
      // quand marque/modèle ne sont pas fournis séparément.
      let make = field(body.make, 40);
      let model = field(body.model, 60);
      let parsedYear = year;
      const vehicle = field(body.vehicle, 100);
      if ((!make || !model) && vehicle) {
        const ym = vehicle.match(/\b(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)\d{2})?\b/);
        if (ym && !parsedYear) parsedYear = ym[0];
        const [first, ...rest] = vehicle.replace(ym?.[0] || "", "").trim().split(/\s+/);
        make = make || first || "";
        model = model || rest.join(" ");
      }
      const request: GuideRequest = {
        make,
        model,
        year: /^[\d\s\-–]*$/.test(parsedYear) ? parsedYear : "",
        equipment: field(body.equipment, 40) || "Diagzone",
        topic: field(body.topic, 120) || undefined,
      };
      if (!request.make || !request.model) {
        return res.status(400).json({ success: false, message: "Marque et modèle requis." });
      }
      const content = await buildGuideContent(request, deps.generate);
      const pdf = await renderGuidePdf(request, content);
      const name = guideFileName(request);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="guide.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`);
      res.setHeader("Content-Length", String(pdf.length));
      return res.end(pdf);
    } catch (error: any) {
      console.error("[Guide PDF]", error?.message || error);
      return res.status(500).json({ success: false, message: "Impossible de générer le guide pour le moment. Réessayez." });
    }
  });
}
