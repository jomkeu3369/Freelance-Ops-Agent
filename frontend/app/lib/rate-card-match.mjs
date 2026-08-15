const genericTerms = new Set(["가격", "기본", "단가", "서비스", "업무", "일반", "작업", "표준"]);

function normalized(value) {
  return String(value ?? "").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "");
}

function terms(value) {
  return String(value ?? "")
    .toLocaleLowerCase("ko-KR")
    .match(/[\p{L}\p{N}]+/gu)?.filter((term) => term.length > 1 && !genericTerms.has(term)) ?? [];
}

function matchScore(item, card) {
  const hint = normalized(item.rateCardHint);
  const name = normalized(card.name);
  const context = normalized(`${item.rateCardHint ?? ""} ${item.title} ${item.description ?? ""}`);
  if (hint && name === hint) return 1_000;
  if (hint && (name.includes(hint) || hint.includes(name))) return 800;
  if (name && context.includes(name)) return 600;
  return terms(card.name).reduce((score, term) => score + (context.includes(normalized(term)) ? 50 : 0), 0);
}

export function selectRateCardForDraftItem(item, rateCards, currency) {
  const compatible = rateCards.filter((card) => card.active && card.unit === item.unit && card.currency === currency);
  if (compatible.length === 0) return null;
  return compatible
    .map((card, index) => ({ card, index, score: matchScore(item, card) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0].card;
}

export function hydrateMissingDraftRates(items, generatedItems) {
  return items.map((item, index) => {
    if (item.rateCardId || item.unitRate > 0) return item;
    const title = normalized(item.title);
    const indexed = generatedItems[index];
    const generated = generatedItems.find((candidate) => normalized(candidate.title) === title)
      ?? (indexed && normalized(indexed.title) === title ? indexed : null);
    return generated?.rateCardId && generated.unitRate > 0
      ? { ...item, rateCardId: generated.rateCardId, unit: generated.unit, unitRate: generated.unitRate }
      : item;
  });
}
