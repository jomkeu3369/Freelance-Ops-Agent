import type { RateCard, RateCardFolder } from "../../../app/lib/api";

export function rateCardFolderPath(folders: RateCardFolder[], folderId: string | null) {
  const path: RateCardFolder[] = [];
  const seen = new Set<string>();
  let current = folders.find((folder) => folder.id === folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = folders.find((folder) => folder.id === current?.parentId);
  }
  return path;
}

export function rateCardFolderOptions(folders: RateCardFolder[], excludedId?: string) {
  return folders
    .filter((folder) => !excludedId || !rateCardFolderPath(folders, folder.id).some((parent) => parent.id === excludedId))
    .map((folder) => ({ id: folder.id, name: rateCardFolderPath(folders, folder.id).map((parent) => parent.name).join(" / ") }))
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));
}

export function rateCardFolderRateCounts(folders: RateCardFolder[], rateCards: RateCard[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const counts = new Map(folders.map((folder) => [folder.id, 0]));
  const counted = new Set<string>();
  for (const card of rateCards) {
    if (counted.has(card.id)) continue;
    counted.add(card.id);
    const seen = new Set<string>();
    let folder = card.folderId ? byId.get(card.folderId) : undefined;
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id);
      counts.set(folder.id, (counts.get(folder.id) ?? 0) + 1);
      folder = folder.parentId ? byId.get(folder.parentId) : undefined;
    }
  }
  return counts;
}
