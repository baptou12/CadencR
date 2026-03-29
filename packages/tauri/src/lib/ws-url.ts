export function getWsUrl(): string {
  const httpUrl = import.meta.env.VITE_API_URL || "http://localhost:5005";
  return httpUrl.replace(/^http/, "ws") + "/ws";
}
