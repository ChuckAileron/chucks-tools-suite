const PREFIX = 'chucks.collapsed.';

export function loadCollapsed(key: string): string[] {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

export function saveCollapsed(key: string, value: readonly string[]): void {
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // almacenamiento no disponible; el colapso solo vive en memoria
  }
}
