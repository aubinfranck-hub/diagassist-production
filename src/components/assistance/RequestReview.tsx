import { vehicleLabel, type VehicleInfo } from "./api";

export default function RequestReview({ atelier, symptoms, phone, vehicle, address, landmark, position, mediaCount, shareDiagnostic }: {
  atelier: boolean; symptoms: string; phone: string; vehicle: VehicleInfo;
  address: string; landmark: string; position: { lat: number; lng: number };
  mediaCount: number; shareDiagnostic: boolean;
}) {
  const rows = [
    ["Prise en charge", atelier ? "Je me rends au garage choisi" : "Un professionnel vient au véhicule"],
    ["Panne", symptoms], ["Téléphone", phone], ["Véhicule", vehicleLabel(vehicle)],
    ["Position confirmée", address || `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`],
    ["Repère", landmark.trim() || "Non précisé"],
    ["Pièces jointes", String(mediaCount)],
    ["Diagnostic DiagAssist", shareDiagnostic ? "Partage autorisé" : "Non partagé"],
  ];
  return (
    <section aria-label="Récapitulatif de ma demande" className="space-y-3">
      <h2 className="text-xl font-black text-white">Vérifiez votre demande</h2>
      <p className="text-sm text-slate-400">Vérifiez le téléphone et l'emplacement du véhicule avant de confirmer.</p>
      <dl className="divide-y divide-white/10">
        {rows.map(([label, value]) => <div key={label} className="py-2.5 space-y-1">
          <dt className="text-xs font-bold text-slate-400">{label}</dt>
          <dd className="text-sm text-white break-words whitespace-pre-wrap">{value}</dd>
        </div>)}
      </dl>
      <p className="text-sm text-amber-300">Vous comparerez les offres avant de choisir un professionnel. L'envoi de cette demande ne valide aucun devis.</p>
    </section>
  );
}
