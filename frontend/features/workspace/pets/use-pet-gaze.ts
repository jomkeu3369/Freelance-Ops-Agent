"use client";

import { useEffect, useRef } from "react";
import { createPetGazeTracker } from "./pet-gaze.mjs";

let tracker: ReturnType<typeof createPetGazeTracker> | null = null;

/** Read-only eye tracking; the SVG silhouette, pet state, and selected agent stay unchanged. */
export function usePetGaze() {
  const portrait = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const pet = portrait.current;
    if (!pet) return;
    tracker ??= createPetGazeTracker(window);
    return tracker.subscribe(pet);
  }, []);
  return portrait;
}
