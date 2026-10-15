import PDFDocument from "pdfkit";
import type { GuideContent, GuideRequest, GuideTableRow, GuideStep } from "./guideTypes";

const RED = "#dc2626";
const DARK = "#0f172a";
const GREY = "#475569";
const LIGHT = "#f1f5f9";
const GREEN = "#15803d";
const AMBER = "#b45309";
const PARTS_PHONE = "0707312797";

// Helvetica (WinAnsi) ne gère pas tous les glyphes Unicode : on remplace les rares cas courants.
function t(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, ">")
    .replace(/[≥]/g, ">=")
    .replace(/[≤]/g, "<=")
    .replace(/ | /g, " ")
    .replace(/ᵉ/g, "e")
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿŒœ–—•€]/g, "");
}

export function guideFileName(r: GuideRequest): string {
  const base = `Guide Technique ${r.equipment} - ${r.make} ${r.model}${r.year ? ` ${r.year}` : ""}`;
  return base.replace(/[^\w\s().-]/g, "").replace(/\s+/g, " ").trim();
}

export function renderGuidePdf(r: GuideRequest, c: GuideContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: guideFileName(r), Author: "DiagAssist" } });
    const chunks: Buffer[] = [];
    doc.on("data", (d: Buffer) => chunks.push(d));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
    const ensure = (h: number) => { if (doc.y + h > bottom()) doc.addPage(); };

    // En-tête
    doc.font("Helvetica-Bold").fontSize(20).fillColor(DARK).text(t(`GUIDE TECHNIQUE ${r.equipment.toUpperCase()}`), L, 40, { width: W });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(GREY)
      .text(t(`${r.make} ${r.model}${r.year ? ` (${r.year})` : ""}  -  ${c.subtitle}`.toUpperCase()), { width: W });
    doc.moveTo(L, doc.y + 6).lineTo(L + W, doc.y + 6).lineWidth(2).strokeColor(RED).stroke();
    doc.y += 16;

    const box = (text: string, label: string, color: string) => {
      doc.font("Helvetica").fontSize(9.5);
      const h = doc.heightOfString(t(text), { width: W - 24 }) + 30;
      ensure(h + 8);
      const y = doc.y;
      doc.rect(L, y, W, h).fill(LIGHT);
      doc.rect(L, y, 4, h).fill(color);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(color).text(t(label), L + 14, y + 8, { width: W - 24 });
      doc.font("Helvetica").fontSize(9.5).fillColor(DARK).text(t(text), L + 14, y + 20, { width: W - 24 });
      doc.y = y + h + 10;
    };

    const heading = (s: string) => {
      ensure(40);
      doc.font("Helvetica-Bold").fontSize(13).fillColor(DARK).text(t(s), L, doc.y, { width: W });
      doc.y += 4;
    };
    const para = (s: string) => {
      if (!s) return;
      doc.font("Helvetica").fontSize(9.5).fillColor(GREY).text(t(s), L, doc.y, { width: W });
      doc.y += 6;
    };

    const table = (head: [string, string, string], rows: GuideTableRow[], widths: number[], flagCol2 = false) => {
      const pad = 6;
      const drawRow = (cells: string[], header: boolean) => {
        doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(9);
        const h = Math.max(...cells.map((cell, i) => doc.heightOfString(t(cell), { width: widths[i] * W - pad * 2 }))) + pad * 2;
        ensure(h);
        const y = doc.y;
        if (header) doc.rect(L, y, W, h).fill(DARK);
        else doc.rect(L, y, W, h).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
        let x = L;
        cells.forEach((cell, i) => {
          let color = header ? "#ffffff" : DARK;
          if (!header && flagCol2 && i === 1) {
            const v = cell.toUpperCase();
            color = v.startsWith("OUI") ? GREEN : v.startsWith("NON") ? RED : AMBER;
            doc.font("Helvetica-Bold");
          } else doc.font(header || i === 0 ? "Helvetica-Bold" : "Helvetica");
          doc.fontSize(9).fillColor(color).text(t(cell), x + pad, y + pad, { width: widths[i] * W - pad * 2 });
          x += widths[i] * W;
        });
        doc.y = y + h;
      };
      drawRow(head, true);
      rows.forEach((row) => drawRow([row.col1, row.col2, row.col3], false));
      doc.y += 10;
    };

    const steps = (list: GuideStep[], letters: boolean) => {
      list.forEach((s, i) => {
        doc.font("Helvetica").fontSize(9.5);
        const h = Math.max(30, doc.heightOfString(t(s.text), { width: W - 40 }) + 24);
        ensure(h + 6);
        const y = doc.y;
        doc.rect(L, y, W, h).fill(LIGHT);
        doc.circle(L + 16, y + 16, 9).fill(RED);
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(letters ? String.fromCharCode(65 + i) : String(i + 1), L + 7, y + 12.5, { width: 18, align: "center" });
        doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK).text(t(s.title), L + 34, y + 7, { width: W - 44 });
        doc.font("Helvetica").fontSize(9.5).fillColor(GREY).text(t(s.text), L + 34, y + 20, { width: W - 44 });
        doc.y = y + h + 6;
      });
      doc.y += 4;
    };

    box(c.goldenRule, "RÈGLE D'OR : SÉCURITÉ ET TENSION", RED);
    heading(`1. ${c.section1Title}`);
    para(c.section1Intro);
    table(["Type d'opération", "Faisable ?", "Détail et méthode requise"], c.capabilities, [0.28, 0.14, 0.58], true);
    heading("2. Préparation et connexion au véhicule");
    steps(c.connectionSteps, false);
    heading(`3. ${c.procedureTitle}`);
    para(c.procedureIntro);
    steps(c.procedureSteps, true);
    heading("4. Réapprentissages obligatoires après l'opération");
    table(["Fonction à réapprendre", "Chemin dans l'outil", "Consigne d'exécution"], c.relearn, [0.27, 0.27, 0.46]);
    box(c.summary, "RÉSUMÉ POUR L'ATELIER", GREEN);
    box(
      `Pièce défectueuse ou remplacement nécessaire : contactez-nous pour l'achat de pièces garanties au ${PARTS_PHONE}. Guide généré automatiquement par DiagAssist : vérifiez les chemins de menu et les valeurs sur la valise avant toute écriture.`,
      "PIÈCES GARANTIES",
      AMBER,
    );

    // Pied de page : numéros de page (après coup, grâce à bufferPages)
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(8).fillColor(GREY)
        .text(t(`Guide Procédure ${r.equipment} - ${r.make} ${r.model}`), L, doc.page.height - 30, { width: W / 2, lineBreak: false })
        .text(`Page ${i + 1} sur ${range.count}`, L + W / 2, doc.page.height - 30, { width: W / 2, align: "right", lineBreak: false });
    }
    doc.end();
  });
}
