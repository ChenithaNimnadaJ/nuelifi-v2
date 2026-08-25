export type TimeOfDay = "morning" | "afternoon" | "evening";

export function getTimeOfDay(hour: number): TimeOfDay {
  const normalizedHour = Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 12;
  if (normalizedHour >= 5 && normalizedHour < 12) return "morning";
  if (normalizedHour >= 12 && normalizedHour < 17) return "afternoon";
  return "evening";
}

export function greetingForHour(hour: number, name = ""): string {
  const prefix = getTimeOfDay(hour) === "morning" ? "Good morning" : getTimeOfDay(hour) === "afternoon" ? "Good afternoon" : "Good evening";
  return name.trim() ? `${prefix}, ${name.trim()}` : "Welcome to Neulifi";
}

export function currentGreeting(name = "", now = new Date()): string {
  return greetingForHour(now.getHours(), name);
}
