"""모델의 금액 주장과 공수 제안을 분리한다. 금액은 견적 서버에서만 계산한다."""

import re

_MONEY = re.compile(
    r"[₩$€¥]\s*\d|(?:KRW|USD|EUR|JPY)\s*\d|"
    r"\d[\d,.]*(?:\s*[십백천만억]\s*[\d,.]*)*\s*(?:원(?!문)|달러|유로|엔|KRW|USD|EUR|JPY)|"
    r"[일이삼사오육칠팔구십백천][일이삼사오육칠팔구십백천만억]*\s*원(?!문)",
    re.IGNORECASE
)
_PRICE_CLAIM = re.compile(r"(?:예산|총액|공급가액|부가세).{0,35}(?:이내|초과|충족|맞췄|맞춘|검증할 수|확정할 수)")


def conversation_text(text: str) -> str:
    sentences = re.split(r"(?<=[.!?。！？])\s+|\n+", text.strip())
    return "\n\n".join(part for part in sentences if not _MONEY.search(part) and not _PRICE_CLAIM.search(part))


def public_conversation_text(text: str) -> str:
    return conversation_text(text) or "금액은 계산된 견적에서 확인해 주세요."
