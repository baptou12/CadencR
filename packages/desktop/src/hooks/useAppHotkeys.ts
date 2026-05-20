import { useMemo, useRef, type DependencyList } from "react";
import { useHotkeys as useTanStackHotkeys } from "@tanstack/react-hotkeys";
import {
  normalizeRegisterableHotkey,
  type ConflictBehavior,
  type HotkeyCallback,
  type HotkeyCallbackContext,
  type RegisterableHotkey,
} from "@tanstack/hotkeys";
import type { UseHotkeyOptions } from "@tanstack/react-hotkeys";
import { expandCharacterHotkey } from "@/lib/shortcuts/character-hotkeys";

export type ShortcutKeys = string | string[];

export interface ShortcutHotkeyOptions extends Omit<
  UseHotkeyOptions,
  "conflictBehavior" | "ignoreInputs"
> {
  conflictBehavior?: ConflictBehavior;
  enableOnContentEditable?: boolean;
  enableOnFormTags?: boolean;
  ignoreInputs?: boolean;
}

const HOTKEY_DEFAULTS = {
  conflictBehavior: "allow" as const,
  ignoreInputs: false,
  preventDefault: false,
  stopPropagation: false,
};

interface ExpandedHotkey {
  exactKeys?: string[];
  hotkey: string;
}

function resolveIgnoreInputs(options: ShortcutHotkeyOptions | undefined): boolean {
  if (options?.ignoreInputs !== undefined) return options.ignoreInputs;

  const enableOnFormTags = options?.enableOnFormTags ?? false;
  const enableOnContentEditable = options?.enableOnContentEditable ?? false;
  return !(enableOnFormTags || enableOnContentEditable);
}

function toTanStackOptions(options: ShortcutHotkeyOptions | undefined): UseHotkeyOptions {
  const {
    enableOnContentEditable: _editable,
    enableOnFormTags: _forms,
    ...tanStackOptions
  } = options ?? {};

  return {
    ...HOTKEY_DEFAULTS,
    ...tanStackOptions,
    ignoreInputs: resolveIgnoreInputs(options),
  };
}

function normalizeShortcutInput(hotkey: string): string {
  return normalizeRegisterableHotkey(hotkey as RegisterableHotkey);
}

function dedupeHotkeys(hotkeys: ExpandedHotkey[]): ExpandedHotkey[] {
  const seen = new Set<string>();
  return hotkeys.filter((hotkey) => {
    const key = `${hotkey.hotkey}:${hotkey.exactKeys?.join("|") ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function expandShortcutInput(keys: ShortcutKeys): ExpandedHotkey[] {
  const rawHotkeys =
    typeof keys === "string" && keys.includes(",") && !keys.includes("+") ? keys.split(",") : keys;
  const hotkeys = Array.isArray(rawHotkeys) ? rawHotkeys : [rawHotkeys];
  return dedupeHotkeys(
    hotkeys.flatMap(expandCharacterHotkey).map((hotkey) => ({
      ...hotkey,
      hotkey: normalizeShortcutInput(hotkey.hotkey),
    })),
  );
}

function toHotkeyCallback(definition: ExpandedHotkey, callback: HotkeyCallback): HotkeyCallback {
  return (event: KeyboardEvent, context: HotkeyCallbackContext) => {
    if (definition.exactKeys && !definition.exactKeys.includes(event.key)) return;
    callback(event, context);
  };
}

export function useAppHotkeys(
  keys: ShortcutKeys,
  callback: HotkeyCallback,
  options?: ShortcutHotkeyOptions,
  _deps?: DependencyList,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const hotkeys = useMemo(() => expandShortcutInput(keys), [keys]);
  const tanStackOptions = useMemo(() => toTanStackOptions(options), [options]);
  const definitions = useMemo(
    () =>
      hotkeys.map((definition) => ({
        hotkey: definition.hotkey as RegisterableHotkey,
        callback: toHotkeyCallback(definition, (event, context) => {
          callbackRef.current(event, context);
        }),
        options: tanStackOptions,
      })),
    [hotkeys, tanStackOptions],
  );

  useTanStackHotkeys(definitions);
}
