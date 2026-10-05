/**
 * Inspected, self-hosted login media. The MP4 contains a short baked-in wrap
 * dissolve, so playback needs one decoder and no animation loop in JavaScript.
 * This softens the generated camera reset; it is not a seamless geometric loop.
 * Motion/data preferences are applied before any video source is attached.
 */
export const loginMedia: {
  sources: Array<{ src: string; type: "video/mp4" | "video/webm" }>;
  poster?: string;
  staticPoster?: string;
} = {
  sources: [{ src: "/login/pet-path-motion-v1.mp4", type: "video/mp4" }],
  poster: "/login/pet-path-motion-poster-v1.webp",
  staticPoster: "/login/pet-path-poster-v1.webp",
};
