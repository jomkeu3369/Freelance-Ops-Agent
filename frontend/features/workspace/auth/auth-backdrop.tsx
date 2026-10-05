"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createAuthMediaController, isAuthMediaPath, normalizeAuthMediaSources } from "./auth-media-policy.mjs";

export interface AuthBackdropSource {
  /** Explicit root-relative path to an approved, same-origin public asset. */
  src: string;
  type: "video/mp4" | "video/webm";
}

export interface AuthBackdropProps {
  /** Omit until an approved video asset exists. No source is assumed. */
  sources?: readonly AuthBackdropSource[];
  poster?: string;
  /** Earlier approved still, shown for explicit pause or motion/data preferences. */
  staticPoster?: string;
  /** Decorative static artwork, retained with or without a video/poster. */
  children?: ReactNode;
  pauseLabel?: string;
  resumeLabel?: string;
}

export function AuthBackdrop({ sources = [], poster, staticPoster, children, pauseLabel = "Pause background video", resumeLabel = "Play background video" }: AuthBackdropProps) {
  const host = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const controller = useRef<ReturnType<typeof createAuthMediaController> | null>(null);
  const [state, setState] = useState({ status: "absent", paused: false, canToggle: false });
  // A parent's ordinary rerender must not reload the video or reset user pause.
  const sourceKey = JSON.stringify(normalizeAuthMediaSources(sources));
  const safePoster = isAuthMediaPath(poster) ? poster : undefined;
  const safeStaticPoster = isAuthMediaPath(staticPoster) ? staticPoster : safePoster;
  // Automatic visibility pauses must not overwrite the user's chosen mode.
  const displayedPoster = state.paused || state.status === "disabled" || state.status === "error"
    ? safeStaticPoster : safePoster;

  useEffect(() => {
    if (!host.current || !video.current) return;
    const active = createAuthMediaController({
      host: host.current,
      video: video.current,
      sources: JSON.parse(sourceKey) as AuthBackdropSource[],
      onStateChange: setState,
    });
    controller.current = active;
    return () => {
      controller.current = null;
      active.dispose();
    };
  }, [sourceKey]);

  return <div className="auth-backdrop" data-media-state={state.status}>
    <div className="auth-backdrop__visual" ref={host} aria-hidden="true">
      <div className="auth-backdrop__fallback">{children}</div>
      {displayedPoster && <Image className="auth-backdrop__poster" src={displayedPoster} alt="" fill sizes="100vw" unoptimized />}
      <video
        ref={video}
        className="auth-backdrop__video"
        hidden={state.status !== "playing"}
        poster={safePoster}
        autoPlay
        muted
        loop
        playsInline
        preload="none"
        tabIndex={-1}
        disablePictureInPicture
        disableRemotePlayback
      />
    </div>
    {state.canToggle && <button
      type="button"
      className="auth-backdrop__toggle"
      onClick={() => controller.current?.toggle()}
      aria-label={state.paused ? resumeLabel : pauseLabel}
      title={state.paused ? resumeLabel : pauseLabel}
    >
      <span aria-hidden="true">{state.paused ? "▶️" : "⏸️"}</span>
    </button>}
  </div>;
}
