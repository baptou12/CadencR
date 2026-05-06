const PROMPT_INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "label",
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="option"]',
].join(", ");

export function shouldFocusPromptFromSurfaceClick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return target.closest(PROMPT_INTERACTIVE_SELECTOR) === null;
}
