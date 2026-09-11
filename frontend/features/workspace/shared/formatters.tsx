import { Project, Client } from "../../../app/lib/api";

export function projectClientLabel(project: Project, clients: Client[]): string {
  if (!project.clientId) return "고객 미연결";
  const client = clients.find((candidate) => candidate.id === project.clientId);
  if (!client) return "연결된 고객";
  return client.companyName ? `${client.companyName} · ${client.name}` : client.name;
}

export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    value
  );
}

export function formatRate(value: number, currency: string): string {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  }).format(value);
}

export function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function externalHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
