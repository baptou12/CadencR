import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-errors";

export function showBrowserError(error: unknown, title: string): void {
  const message = apiErrorMessage(error, String(error));
  toast.error(title, { description: message });
}

export function reportBrowserError(error: unknown): void {
  showBrowserError(error, "Browser action failed");
}
