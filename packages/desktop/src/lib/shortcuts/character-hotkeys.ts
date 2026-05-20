export interface CharacterHotkeyVariant {
  exactKey?: string;
  hotkey: string;
}

function isShiftToken(token: string): boolean {
  return token.trim().toLowerCase() === "shift";
}

function isSingleNonLetterCharacter(key: string): boolean {
  return key.length === 1 && !/^\p{Letter}$/u.test(key);
}

function withOptionalShift(
  modifiers: string[],
  key: string,
  exactKey: string,
): CharacterHotkeyVariant[] {
  return [
    { hotkey: [...modifiers, key].join("+"), exactKey },
    { hotkey: [...modifiers, "Shift", key].join("+"), exactKey },
  ];
}

export function expandCharacterHotkey(hotkey: string): CharacterHotkeyVariant[] {
  const parts = hotkey.split("+").map((part) => part.trim());
  const key = parts.at(-1);
  if (!key) return [{ hotkey }];

  const modifiers = parts.slice(0, -1);
  const hasExplicitShift = modifiers.some(isShiftToken);

  if (key === "Plus") {
    const engineKeys = ["=", "/"];
    if (hasExplicitShift) {
      return engineKeys.map((engineKey) => ({
        hotkey: [...modifiers, engineKey].join("+"),
        exactKey: "+",
      }));
    }
    return engineKeys.flatMap((engineKey) => withOptionalShift(modifiers, engineKey, "+"));
  }

  if (!isSingleNonLetterCharacter(key)) return [{ hotkey }];
  if (hasExplicitShift) return [{ hotkey }];

  return withOptionalShift(modifiers, key, key);
}
