export type VehicleSource = "hp_web" | "cache" | "manual";

export interface VehicleContext {
  vin?: string;
  source: VehicleSource;
  make: string;
  model: string;
  year?: string | number;
  generation?: string;
  engine?: string;
  fuel?: string;
  displacement?: string;
  power?: string;
  transmission?: string;
  retrievedAt: string;
  technicalData?: Record<string, unknown>;
}

export interface VehicleSearchQuery {
  vin?: string;
  make?: string;
  model?: string;
  year?: string | number;
  engine?: string;
  q?: string;
}

/**
 * Contrat interne unique pour toutes les recherches véhicule.
 * HP-Web pourra alimenter ce contrat sans exposer sa navigation au Live Agent.
 */
export interface VehicleDataGateway {
  lookup(query: VehicleSearchQuery): Promise<VehicleContext[]>;
}
