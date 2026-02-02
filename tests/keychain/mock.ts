// In-memory mock keychain for testing
const store = new Map<string, string>();

export async function set(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function get(key: string): Promise<string | null> {
  return store.get(key) ?? null;
}

export async function remove(key: string): Promise<boolean> {
  return store.delete(key);
}

export async function list(): Promise<string[]> {
  return [...store.keys()];
}

export function clear(): void {
  store.clear();
}
