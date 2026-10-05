package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.PetPreferences;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.stereotype.Component;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/** Free, deterministic preset composition. No provider, credentials, tools or raw prompt injection. */
@Component
public class PetPromptComposer {
    private static final Pattern NAME = Pattern.compile("(?:이름(?:은|을)?\\s*[:=]?\\s*|name\\s*(?:is|:|=)?\\s*)[\"']?([\\p{L}\\p{N}_-]{1,20})", Pattern.CASE_INSENSITIVE);

    public PetProfile compose(UUID id, String description, PetProfile previous) {
        String text = description.toLowerCase(Locale.ROOT);
        var base = previous == null ? new PetProfile("RECOMMENDED", "나의 동료", "owl", "lavender", "none", "WARM", "BALANCED", "BALANCED", "BALANCED") : previous;
        String name = base.name();
        var match = NAME.matcher(description);
        if (match.find()) name = match.group(1);
        String animal = choose(text, base.animal(), new String[][] {{"turtle", "거북", "turtle"}, {"owl", "부엉", "올빼미", "owl"}, {"cat", "고양", "cat"}});
        String color = choose(text, base.color(), new String[][] {{"sage", "초록", "세이지", "green", "sage"}, {"lavender", "보라", "라벤더", "purple", "lavender"}, {"peach", "살구", "주황", "peach"}, {"sky", "하늘", "파랑", "blue"}, {"rose", "분홍", "장미", "pink"}, {"ink", "검정", "먹색", "black"}});
        String accessory = choose(text, base.accessory(), new String[][] {{"glasses", "안경", "glasses"}, {"scarf", "스카프", "목도리", "scarf"}, {"star", "별 장식", "star"}, {"none", "장식 없", "장식 없이", "장식 빼", "no accessory"}});
        String tone = choose(text, base.tone(), new String[][] {{"WARM", "친근", "다정", "friendly", "warm"}, {"DIRECT", "간결", "짧게", "직접적", "concise", "direct"}, {"FORMAL", "정중", "격식", "formal", "polite"}});
        String value = choose(text, base.valuePriority(), new String[][] {{"PROFIT", "수익", "profit"}, {"RELATIONSHIP", "관계", "relationship"}, {"BALANCED", "균형", "balanced"}});
        String delivery = choose(text, base.deliveryPriority(), new String[][] {{"SPEED", "빠르게", "신속", "speed"}, {"QUALITY", "꼼꼼", "완성도", "품질", "quality", "careful"}, {"BALANCED", "균형", "balanced"}});
        String scope = choose(text, base.scopePriority(), new String[][] {{"CAUTIOUS", "보수", "신중", "cautious"}, {"EXPLORATORY", "도전", "탐색", "exploratory"}, {"BALANCED", "균형", "balanced"}});
        String duty = choose(text, base.duty(), new String[][] {{"SCHEDULE", "일정", "납기", "schedule", "deadline"}, {"RESEARCH", "조사", "근거", "research"}, {"WRITING", "글쓰기", "문서", "카피", "writing"}, {"DEVELOPMENT", "개발", "코딩", "development", "coding"}, {"DESIGN", "디자인", "design"}, {"GENERAL", "일반 업무", "general"}});
        var old = base.preferences();
        if (old.requests().size() >= 6) throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "PET_PREFERENCE_HISTORY_FULL");
        var requests = new java.util.ArrayList<>(old.requests());
        requests.add(description);
        // Explicit labels can replace individual arbitrary preferences; unlabelled text stays verbatim.
        String personality = labelled(description, "성향|personality", old.personality());
        String communication = labelled(description, "말투|tone", old.communication());
        String focus = labelled(description, "중점|focus", old.focus());
        String responsibility = labelled(description, "업무|담당 업무|role", old.responsibility());
        return new PetProfile("RECOMMENDED", name, animal, color, accessory, tone, value, delivery, scope, id, duty, "AUTO",
            new PetPreferences(personality, communication, focus, responsibility, java.util.List.copyOf(requests)));
    }

    private static String labelled(String text, String label, String fallback) {
        var match = Pattern.compile("(?:^|[.;!?。；\\n])\\s*(?:" + label + ")\\s*[:：]\\s*([^;\\n]+)", Pattern.CASE_INSENSITIVE).matcher(text);
        String result = fallback;
        while (match.find()) result = match.group(1).strip();
        return result;
    }

    private static String choose(String text, String fallback, String[][] choices) {
        // Last matching phrase wins so short conversational corrections can override earlier preferences.
        int last = -1;
        String selected = fallback;
        for (var choice : choices) for (int i = 1; i < choice.length; i++) {
            int position = text.lastIndexOf(choice[i]);
            if (position > last) { last = position; selected = choice[0]; }
        }
        return selected;
    }
}
