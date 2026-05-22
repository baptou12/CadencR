import { useCallback, useMemo, useRef, useState } from "react";

interface UseControllableBooleanOptions {
  /** Controlled value. When defined, the hook behaves as a controlled component. */
  value: boolean | undefined;
  /** Notified on every toggle, whether the hook is controlled or not. */
  onChange?: (next: boolean) => void;
  /** Initial uncontrolled value. Ignored when `value` is defined. */
  defaultValue?: boolean;
}

interface UseControllableBooleanResult {
  value: boolean;
  toggle: () => void;
  setValue: (next: boolean) => void;
}

/**
 * Boolean state that supports both controlled (`value` provided) and
 * uncontrolled (`value === undefined`) usage. Returns referentially stable
 * `toggle` / `setValue` callbacks and a memoised object so consumers can
 * safely thread the result through `React.memo` boundaries.
 */
export function useControllableBoolean({
  value,
  onChange,
  defaultValue = false,
}: UseControllableBooleanOptions): UseControllableBooleanResult {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const current = isControlled ? value : internal;

  // Mirror the latest value into a ref so `toggle` stays referentially
  // stable even as the boolean flips — otherwise the returned object would
  // re-identify every render.
  const currentRef = useRef(current);
  currentRef.current = current;
  const isControlledRef = useRef(isControlled);
  isControlledRef.current = isControlled;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const setValue = useCallback((next: boolean): void => {
    onChangeRef.current?.(next);
    if (!isControlledRef.current) setInternal(next);
  }, []);

  const toggle = useCallback((): void => setValue(!currentRef.current), [setValue]);

  return useMemo(() => ({ value: current, toggle, setValue }), [current, toggle, setValue]);
}
