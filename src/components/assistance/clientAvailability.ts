import type { AssistanceStatus, ServiceInfo } from "./api";

// This catalogue is only for preparing an offline request, never proof of availability.
const OFFLINE_SERVICES: ServiceInfo[] = [
  ["mecanique", "Mécanique"], ["electricite", "Électricité"],
  ["diagnostic", "Diagnostic"], ["batterie", "Batterie"],
  ["pneumatiques", "Pneus"], ["remorquage", "Remorquage"], ["vidange", "Vidange"],
].map(([code, label]) => ({ code, label, available: false }));

export function requestServices(status: AssistanceStatus | null, online: boolean): ServiceInfo[] {
  return !online ? OFFLINE_SERVICES : status?.services || [];
}

export function serviceSelectable(service: ServiceInfo | undefined, atelier: boolean, online: boolean): boolean {
  return !!service && (!online || (atelier ? (service.atelierAvailable ?? service.available) : service.available));
}

export function canPrepareRequest(status: AssistanceStatus | null, online: boolean): boolean {
  if (!online) return true;
  return !!status?.enabled && status.dbConfigured && status.services.some(s => s.available || s.atelierAvailable);
}
