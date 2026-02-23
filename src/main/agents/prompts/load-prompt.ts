import { readFileSync } from "node:fs";
import { join } from "node:path";

const cache = new Map<string, string>();

export function loadPrompt(name: string): string {
  if (cache.has(name)) return cache.get(name)!;
  const text = readFileSync(join(__dirname, name), "utf-8");
  cache.set(name, text);
  return text;
}
