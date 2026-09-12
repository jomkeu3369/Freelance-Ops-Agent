import type { PetProfile } from "@/app/lib/api";
import { petAdvisors } from "./pet-state.mjs";

export const petDefaults: PetProfile[] = [
  { slot: "LEAN", name: "차근", animal: "turtle", color: "sage", accessory: "none", tone: "WARM", valuePriority: "BALANCED", deliveryPriority: "SPEED", scopePriority: "CAUTIOUS" },
  { slot: "RECOMMENDED", name: "또렷", animal: "owl", color: "lavender", accessory: "none", tone: "FORMAL", valuePriority: "BALANCED", deliveryPriority: "QUALITY", scopePriority: "BALANCED" },
  { slot: "EXPANDED", name: "든든", animal: "cat", color: "peach", accessory: "none", tone: "DIRECT", valuePriority: "PROFIT", deliveryPriority: "BALANCED", scopePriority: "EXPLORATORY" }
];
export const petColors = { sage: "세이지", lavender: "라벤더", peach: "살구", sky: "하늘", rose: "장미", ink: "먹색" };
export const preferenceLabels: Record<string, string> = { PROFIT: "수익 우선", RELATIONSHIP: "관계 우선", BALANCED: "균형", SPEED: "빠른 납품", QUALITY: "완성도 우선", CAUTIOUS: "보수적 범위", EXPLORATORY: "도전적 제안" };
export function advisorsWithProfiles(profiles?: PetProfile[]) {
  return petAdvisors.map(advisor => {
    const profile = profiles?.find(pet => pet.slot === advisor.scenario) ?? petDefaults.find(pet => pet.slot === advisor.scenario)!;
    return { ...advisor, name: profile.name, profile, priority: [profile.valuePriority, profile.deliveryPriority, profile.scopePriority].map(value => preferenceLabels[value]).join(" · ") };
  });
}
