import { useState } from "react";
import { useT } from "../../../app/lib/ui-language";
import { PetArt } from "./pet-art";
import { petDefaults } from "./pet-profile";

const examples = [
  { prompt: "친근하게 말하고 일정 관리를 꼼꼼히 챙기는 펫", profile: { ...petDefaults[0], name: "차근", color: "sky" as const, accessory: "scarf" as const } },
  { prompt: "차분한 선생님 말투로 글쓰기를 도와주는 고양이", profile: { ...petDefaults[2], name: "글벗", color: "rose" as const, accessory: "glasses" as const } },
  { prompt: "빠뜨린 근거를 찾아주는 호기심 많은 부엉이", profile: { ...petDefaults[1], name: "돋보기", accessory: "star" as const } }
];

export function PetLoginDemo() {
  const t = useT();
  const [selected, setSelected] = useState(0);
  const example = examples[selected];
  return <div className="pet-login-demo" aria-label={t("커스텀 펫 예시")}>
    <p>{t("한 문장으로, 나에게 맞는 동료를.")}</p>
    <div className="pet-demo-result"><PetArt kind={example.profile.animal} profile={example.profile}/><div><strong>{t(example.profile.name)}</strong><p>{t(example.prompt)}</p></div></div>
    <div className="pet-demo-options">{examples.map((item, index) => <button key={item.profile.name} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>{t(["일정", "글쓰기", "근거"][index])}</button>)}</div>
    <small>{t("예시 미리보기입니다. 로그인 후 나만의 펫을 추가하고 대화로 수정할 수 있어요.")}</small>
  </div>;
}
