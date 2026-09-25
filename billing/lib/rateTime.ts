export function getIstDateAndSession() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour"));
  const session: "AM" | "PM" = hour < 12 ? "AM" : "PM";

  return { date, session };
}
