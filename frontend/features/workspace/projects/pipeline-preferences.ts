import { Project } from "../../../app/lib/api";

export interface PipelinePreferences {
  search: string;
  searchResults?: Project[] | null;
  activeColumn: string;
  preferredView: "board" | "list" | null;
  sort: "updated" | "deadline";
}
