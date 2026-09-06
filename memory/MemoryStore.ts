export interface MemoryItem {
  id: string;
  key: string;
  value: string;
  timestamp: number;
  category?: "preference" | "fact" | "context";
}

export interface MemoryStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, category?: MemoryItem["category"]): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<MemoryItem[]>;
  clear(): Promise<void>;
}

export class LocalMemoryStore implements MemoryStore {
  private static STORAGE_KEY = "voxflow_memory_store_v1";

  private getItems(): MemoryItem[] {
    if (typeof window === "undefined") return [];
    try {
      const data = localStorage.getItem(LocalMemoryStore.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveItems(items: MemoryItem[]): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LocalMemoryStore.STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage limits or private mode
    }
  }

  public async get(key: string): Promise<string | null> {
    const items = this.getItems();
    const match = items.find((i) => i.key.toLowerCase() === key.toLowerCase());
    return match ? match.value : null;
  }

  public async set(key: string, value: string, category: MemoryItem["category"] = "fact"): Promise<void> {
    const items = this.getItems();
    const existingIdx = items.findIndex((i) => i.key.toLowerCase() === key.toLowerCase());

    const item: MemoryItem = {
      id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      key,
      value,
      timestamp: Date.now(),
      category,
    };

    if (existingIdx !== -1) {
      items[existingIdx] = item;
    } else {
      items.push(item);
    }

    this.saveItems(items);
  }

  public async delete(key: string): Promise<void> {
    const items = this.getItems().filter((i) => i.key.toLowerCase() !== key.toLowerCase());
    this.saveItems(items);
  }

  public async list(): Promise<MemoryItem[]> {
    return this.getItems();
  }

  public async clear(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem(LocalMemoryStore.STORAGE_KEY);
    } catch {}
  }
}
