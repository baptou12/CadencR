import { prompts } from "./index";

export function loadPrompt(name: string): string {
  const text = prompts[name as keyof typeof prompts];
  if (!text) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  return text;
}
