export type ScreeningRole = "technician" | "coach";
export type ScreeningCoachType = "gemini" | "human";
export type ScreeningCommand = "click" | "scroll" | "input" | "back" | "request_screen";
export interface ScreeningSession { id:string; technicianPhone:string; coachPhone?:string; pairingCode:string; status:"pending"|"active"|"completed"; coachType:"gemini"|"human"; humanCoachRequested:boolean; createdAt:number; expiresAt:number; frameCount:number; }
export interface VisionAnalysis { screenDescription:string; detectedDTCs:Array<{code:string;description:string;confidence:number}>; observations:string[]; possibleCauses:string[]; recommendedTests:string[]; warnings:string[]; confidence:number; requiresHumanValidation:boolean; }