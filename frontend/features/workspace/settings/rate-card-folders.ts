import type { RateCardFolder } from "../../../app/lib/api";

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
