import { toast } from "sonner";

export function showBrowserError(error: unknown, title: string): void {
  const message = error instanceof Error ? error.message : String(error);
  toast.error(title, { description: message });
}

export function reportBrowserError(error: unknown): void {
  showBrowserError(error, "Browser action failed");
}
