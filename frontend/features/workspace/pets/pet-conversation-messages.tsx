import type { PetMessage, WorkflowEvent } from "../../../app/lib/api";
import { useT, useUiLocale } from "../../../app/lib/ui-language";
import { ChatMarkdown } from "../shared/chat-markdown";
import { PetArt } from "./pet-art";
import { conversationText } from "./pet-conversation-text.mjs";

export function conversationMessages(saved: PetMessage[] | undefined, events: WorkflowEvent[]) {
  const messages = new Map((saved ?? []).map(message => [message.messageId,message]));
  for (const event of events) if (event.type === "pet.message.completed") {
    const message = event.data as unknown as PetMessage;
    if (typeof message.messageId === "string" && typeof message.text === "string") messages.set(message.messageId,message);
  }
  return [...messages.values()];
}
export function PetConversationMessages({ messages }: { messages: PetMessage[] }) {
  const t = useT(); const locale = useUiLocale();
  return <div className="pet-conversation-messages">{messages.map(message => {
    const previous = messages.find(item => item.messageId === message.replyToMessageId);
    return <article className="pet-conversation-message" key={message.messageId} data-speaker-id={message.speakerPetId ?? "ai"}>
      {message.speaker && <PetArt kind={message.speaker.animal} profile={message.speaker} />}
      <div><strong>{message.speaker?.name ?? t("프로젝트 AI")}</strong>
        {previous && <p className="pet-conversation-reply">{t("{name}에게 답변",{name:previous.speaker?.name ?? t("프로젝트 AI")})}</p>}
        <ChatMarkdown locale={locale}>{conversationText(message.text) || t("금액은 계산된 견적에서 확인해 주세요.")}</ChatMarkdown>
        {message.evidence?.map(source => <details className="pet-conversation-evidence" key={source.id}><summary>{source.title}</summary><p>{source.content}</p></details>)}
      </div>
    </article>;
  })}</div>;
}
