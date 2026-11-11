import type { Database } from "@/integrations/supabase/types";

export type OffsyProfile = Database["public"]["Tables"]["profiles"]["Row"];
export type OffsyDepartment = Database["public"]["Tables"]["departments"]["Row"];
export type OffsyLeaveType = Database["public"]["Tables"]["leave_types"]["Row"];
export type OffsyBalance = Database["public"]["Tables"]["leave_balances"]["Row"];
export type OffsyRequest = Database["public"]["Tables"]["leave_requests"]["Row"];
export type OffsyHoliday = Database["public"]["Tables"]["holidays"]["Row"];
export type OffsyNotification = Database["public"]["Tables"]["notifications"]["Row"];
export type OffsyRole = Database["public"]["Enums"]["app_role"];

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "O";
}

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en", options ?? { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${date}T12:00:00`),
  );
}

export function formatLeaveStatus(status: OffsyRequest["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function availableDays(balance: OffsyBalance) {
  return Math.max(0, Number(balance.entitled_days) - Number(balance.used_days));
}