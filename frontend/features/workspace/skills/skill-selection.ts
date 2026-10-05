import catalog from "./catalog.json";
import rules from "./routing.json";

export interface SkillSelection { mode: "AUTO" | "MANUAL"; manualIds: string[]; excludedIds: string[]; catalogVersion: "1.0.0"; }
export const defaultSkillSelection: SkillSelection = { mode: "AUTO", manualIds: [], excludedIds: [], catalogVersion: "1.0.0" };
export const skills = catalog.skills;
export function normalizeSkillSelection(value: unknown): SkillSelection {
  if (value == null) return { ...defaultSkillSelection, manualIds: [], excludedIds: [] };
  if (typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !["mode", "manualIds", "excludedIds", "catalogVersion"].includes(key))) throw new Error("Invalid skill selection");
  const x = value as SkillSelection;
  const known = new Set(skills.map(skill => skill.id));
  if (!["AUTO", "MANUAL"].includes(x.mode) || x.catalogVersion !== "1.0.0" || !Array.isArray(x.manualIds) || !Array.isArray(x.excludedIds)
      || x.manualIds.length > 3 || x.excludedIds.length > 60 || [...x.manualIds, ...x.excludedIds].some(id => !known.has(id))
      || new Set(x.manualIds).size !== x.manualIds.length || new Set(x.excludedIds).size !== x.excludedIds.length) throw new Error("Invalid skill selection");
  return { mode: x.mode, manualIds: [...x.manualIds], excludedIds: [...x.excludedIds], catalogVersion: "1.0.0" };
}
export function resolveSkills(text: string, selection: SkillSelection): { selected: string[]; deferred: string[] } {
  if (selection.mode === "MANUAL") return { selected: [...selection.manualIds], deferred: [] };
  const matched = Object.entries(rules).filter(([id, rule]) => !selection.excludedIds.includes(id)
    && !("not" in rule && new RegExp(rule.not, "i").test(text))
    && rule.all.every(pattern => new RegExp(pattern, "i").test(text))).map(([id]) => id);
  return { selected: matched.slice(0, 3), deferred: matched.slice(3) };
}
export function skillSelectionSignature(value?: SkillSelection): string {
  // Legacy requests without a choice must not reuse an Auto request's authorization.
  return JSON.stringify(value == null ? null : normalizeSkillSelection(value));
}
