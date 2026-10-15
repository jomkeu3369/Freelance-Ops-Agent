"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createAuthMediaController, isAuthMediaPath, normalizeAuthMediaSources } from "./auth-media-policy.mjs";

export interface AuthBackdropSource {
  /** 같은 출처에서 승인된 공개 자산의 루트 상대 경로만 허용한다. */
  src: string;
  type: "video/mp4" | "video/webm";
}

export interface AuthBackdropProps {
  /** 승인된 영상이 있을 때만 지정하며 기본 소스를 가정하지 않는다. */
  sources?: readonly AuthBackdropSource[];
  poster?: string;
  /** 일시정지나 동작·데이터 절약 설정에서 표시하는 승인된 정지 이미지다. */
  staticPoster?: string;
  /** 영상이나 포스터 유무와 관계없이 유지하는 정적 장식이다. */
  children?: ReactNode;
  pauseLabel?: string;
  resumeLabel?: string;
}

export function AuthBackdrop({ sources = [], poster, staticPoster, children, pauseLabel = "Pause background video", resumeLabel = "Play background video" }: AuthBackdropProps) {
  const host = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const controller = useRef<ReturnType<typeof createAuthMediaController> | null>(null);
  const [state, setState] = useState({ status: "absent", paused: false, canToggle: false });
  // 부모가 다시 렌더링돼도 영상을 재로드하거나 사용자의 일시정지를 초기화하지 않는다.
  const sourceKey = JSON.stringify(normalizeAuthMediaSources(sources));
  const safePoster = isAuthMediaPath(poster) ? poster : undefined;
  const safeStaticPoster = isAuthMediaPath(staticPoster) ? staticPoster : safePoster;
  // 자동 가시성 일시정지는 사용자가 선택한 재생 모드를 변경하지 않는다.
  const displayedPoster =
    state.paused || state.status === "disabled" || state.status === "error" ? safeStaticPoster : safePoster;

  useEffect(() => {
    if (!host.current || !video.current) return;
    const active = createAuthMediaController({
      host: host.current,
      video: video.current,
      sources: JSON.parse(sourceKey) as AuthBackdropSource[],
      onStateChange: setState
    });
    controller.current = active;
    return () => {
      controller.current = null;
      active.dispose();
    };
  }, [sourceKey]);

  return (
    <div className="auth-backdrop" data-media-state={state.status}>
      <div className="auth-backdrop__visual" ref={host} aria-hidden="true">
        <div className="auth-backdrop__fallback">{children}</div>
        {displayedPoster && (
          <Image className="auth-backdrop__poster" src={displayedPoster} alt="" fill sizes="100vw" unoptimized />
        )}
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
      {state.canToggle && (
        <button
          type="button"
          className="auth-backdrop__toggle"
          onClick={() => controller.current?.toggle()}
          aria-label={state.paused ? resumeLabel : pauseLabel}
          title={state.paused ? resumeLabel : pauseLabel}
        >
          <span aria-hidden="true">{state.paused ? "▶️" : "⏸️"}</span>
        </button>
      )}
    </div>
  );
}
