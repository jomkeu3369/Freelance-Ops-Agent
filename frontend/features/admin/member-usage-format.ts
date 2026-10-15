// 센트 미만 원장 금액을 보존하도록 소수점 8자리로 표시한다. 지출 승인은 별도다.
export function formatAdminUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 8
  }).format(value);
}
