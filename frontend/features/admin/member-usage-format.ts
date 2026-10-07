// Eight decimal places preserve sub-cent ledger amounts; this display never authorizes spending.
export function formatAdminUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(value);
}
