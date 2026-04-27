export type AlertTrigger = 
  | "intrusion" 
  | "violence" 
  | "fire" 
  | "smoke" 
  | "safety_gear" 
  | "fall";

export interface Camera {
  id: string;
  name: string;
  location: string;
  type: "webcam" | "ip";
  url?: string;
  status: "online" | "offline";
  enabledTriggers: AlertTrigger[];
  onvif?: {
    user?: string;
    password?: string;
    port?: number;
    active?: boolean;
  };
}

export interface Incident {
  id: string;
  timestamp: Date;
  cameraId: string;
  cameraName: string;
  description: string;
  threatLevel: "low" | "medium" | "high";
  screenshot?: string;
}
