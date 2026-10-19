export interface PixelPetSprite {
  species: string;
  palette: string[];
  rows: string[];
}

export interface PetProfile {
  petId?: string | null;
  duty?: "GENERAL" | "SCHEDULE" | "RESEARCH" | "WRITING" | "DEVELOPMENT" | "DESIGN";
  skillMode?: "AUTO";
  preferences?: {
    personality: string;
    communication: string;
    focus: string;
    responsibility: string;
    requests: string[];
  };
  slot: "LEAN" | "RECOMMENDED" | "EXPANDED";
  name: string;
  animal: "turtle" | "owl" | "cat" | "pixel";
  sprite?: PixelPetSprite | null;
  color: "sage" | "lavender" | "peach" | "sky" | "rose" | "ink";
  accessory: "none" | "glasses" | "scarf" | "star";
  tone: "WARM" | "DIRECT" | "FORMAL";
  valuePriority: "PROFIT" | "BALANCED" | "RELATIONSHIP";
  deliveryPriority: "SPEED" | "BALANCED" | "QUALITY";
  scopePriority: "CAUTIOUS" | "BALANCED" | "EXPLORATORY";
}

export interface CustomAgentPet {
  id: string;
  profile: PetProfile;
  archived: boolean;
  revision: number;
}

export interface AgentPetCollection {
  pets: CustomAgentPet[];
  selectedPetId: string | null;
  maxActivePets: number;
  maxStoredPets: number;
  maxPromptLength: number;
  maxPreferenceRequests: number;
  generationMode: "RULE_BASED_PREVIEW" | "MODEL_PIXEL";
  aiGenerationAvailable: boolean;
}

export interface ComposeAgentPet {
  id: string;
  mutationId: string;
  expectedRevision: number;
  description: string;
  resetPreferences: boolean;
  generationId?: string | null;
}

export interface PixelPetGeneration {
  id: string;
  status: "REQUESTED" | "COMPLETED" | "FAILED" | "UNKNOWN";
  profile: PetProfile | null;
  errorCode: string | null;
}
