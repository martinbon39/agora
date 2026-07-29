// Minimal stand-in for t3code's effect-Schema-backed localStorage helpers.
// The schema argument is accepted for API compatibility and ignored: values
// round-trip through JSON, which covers the numbers/strings the ui uses.
export function getLocalStorageItem<T>(key: string, _schema?: unknown): T | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function setLocalStorageItem<T>(key: string, value: T, _schema?: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable — a lost sidebar width is not an error
  }
}
