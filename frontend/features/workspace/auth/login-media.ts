/**
 * Approved, self-hosted login media only.
 * The user-approved pet-path concept is the current static poster.
 * A moving clip is still pending; this poster is not represented as a video.
 * Keep video sources empty until the actual delivered clip is inspected and optimized.
 */
export const loginMedia: {
  sources: Array<{ src: string; type: "video/mp4" | "video/webm" }>;
  poster?: string;
} = { sources: [], poster: "/login/pet-path-poster-v1.webp" };
