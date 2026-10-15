/** 변환 setter를 재사용해 매 스크롤 프레임마다 tween이 쌓이지 않게 한다.
 * 초기 자세는 호출한 context에 저장하므로 revert 시 원래 상태로 돌아간다. */
export function createBrandFlightRenderer(animation, target) {
  const setX = animation.quickSetter(target, "x", "px");
  const setY = animation.quickSetter(target, "y", "px");
  // CSSPlugin의 scale 별칭은 quickSetter 속성이 아니므로
  // 실제 두 축을 함께 변경해 표식이 균일하게 줄어들게 한다.
  const setScaleX = animation.quickSetter(target, "scaleX");
  const setScaleY = animation.quickSetter(target, "scaleY");
  return ({ x, y, scale }) => {
    setX(x);
    setY(y);
    setScaleX(scale);
    setScaleY(scale);
  };
}
