/** 직접 호스팅하는 로그인 미디어다. MP4에 짧은 화면 전환이 포함돼
 * 디코더 하나로 재생하며 자바스크립트 반복 애니메이션은 필요 없다.
 * 카메라 초기화를 완화하는 전환이며 기하학적으로 이어지는 반복 영상은 아니다.
 * 소스를 연결하기 전에 동작·데이터 절약 설정을 적용한다. */
export const loginMedia: {
  sources: Array<{ src: string; type: "video/mp4" | "video/webm" }>;
  poster?: string;
  staticPoster?: string;
} = {
  sources: [{ src: "/login/pet-path-motion-v1.mp4", type: "video/mp4" }],
  poster: "/login/pet-path-motion-poster-v1.webp",
  staticPoster: "/login/pet-path-poster-v1.webp"
};
