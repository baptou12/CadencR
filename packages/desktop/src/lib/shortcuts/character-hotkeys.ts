export interface CharacterHotkeyVariant {
  exactKeys?: string[];
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
    { hotkey: [...modifiers, key].join("+"), exactKeys: [exactKey] },
    { hotkey: [...modifiers, "Shift", key].join("+"), exactKeys: [exactKey] },
  ];
}

function characterVariant(
  modifiers: string[],
  key: string,
  exactKeys: string[],
): CharacterHotkeyVariant {
  return { hotkey: [...modifiers, key].join("+"), exactKeys };
}

export function expandCharacterHotkey(hotkey: string): CharacterHotkeyVariant[] {
  const parts = hotkey.split("+").map((part) => part.trim());
  const key = parts.at(-1);
  if (!key) return [{ hotkey }];

  const modifiers = parts.slice(0, -1);
  const hasExplicitShift = modifiers.some(isShiftToken);

  if (key === "Plus") {
    const equalKey = [
      characterVariant(modifiers, "=", ["+"]),
      characterVariant([...modifiers, "Shift"], "=", ["+", "="]),
    ];
    const slashKey = withOptionalShift(modifiers, "/", "+");
    if (hasExplicitShift) {
      return [
        characterVariant(modifiers, "=", ["+", "="]),
        characterVariant(modifiers, "/", ["+"]),
      ];
    }
    return [...equalKey, ...slashKey];
  }

  if (key === "-") return [{ hotkey, exactKeys: ["-"] }];

  if (!isSingleNonLetterCharacter(key)) return [{ hotkey }];
  if (hasExplicitShift) return [{ hotkey }];

  return withOptionalShift(modifiers, key, key);
}
