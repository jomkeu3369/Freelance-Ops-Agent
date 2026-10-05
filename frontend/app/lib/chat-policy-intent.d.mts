export interface ChatPolicyValues {
  defaultTaxRate: number;
  defaultRiskBufferRate: number;
  maximumDiscountRate: number;
}
export function parseChatPolicyIntent(message: string):
  | null
  | { valid: false; values: Record<string, never> }
  | { valid: true; values: Partial<ChatPolicyValues> };
