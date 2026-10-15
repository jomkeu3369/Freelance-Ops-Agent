
export interface CreditModelRate {
  provider: string;
  model: string;
  credits: number;
  enabled: boolean;
}

export interface CreditQuote {
  credits: number;
  pricingUpdatedAt: string;
}

export interface FreeUsage {
  unit?: "CREDITS";
  periodType?: "WEEKLY";
  modelRates?: CreditModelRate[];
  pricingUpdatedAt?: string;
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  resetAt: string;
  period: string;
  timezone: string;
  epoch: number;
  canManage: boolean;
}

export interface FreeUsageSettings {
  unit?: "CREDITS";
  periodType?: "WEEKLY";
  modelRates?: CreditModelRate[];
  limit: number;
  maxLimit: number;
  epoch: number;
  updatedAt: string;
  lastResetAt: string | null;
}
