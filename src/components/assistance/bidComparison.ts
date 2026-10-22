import type { Bid } from "./api";
export type BidSort = "price" | "eta" | "rating";
export function compareBids(bids: Bid[], sort: BidSort, budget: number | null, maxEta: number | null, now: number) {
  return bids.filter(b => b.validUntil > now && (budget === null || b.amount <= budget) && (maxEta === null || b.etaMinutes <= maxEta))
    .sort((a, b) => {
      if (sort === "rating") return (b.pro.rating?.avg || 0) - (a.pro.rating?.avg || 0)
        || (b.pro.rating?.count || 0) - (a.pro.rating?.count || 0) || a.amount - b.amount;
      return sort === "eta" ? a.etaMinutes - b.etaMinutes || a.amount - b.amount : a.amount - b.amount || a.etaMinutes - b.etaMinutes;
    });
}
