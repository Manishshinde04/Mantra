import { MemoryStore, LocalMemoryStore, MemoryItem } from "./MemoryStore";
import { AIChatMessage } from "@/ai/types";

export class ConversationMemory {
  private store: MemoryStore;

  constructor(store?: MemoryStore) {
    this.store = store || new LocalMemoryStore();
  }

  public async rememberUserFact(key: string, value: string): Promise<void> {
    await this.store.set(key, value, "fact");
  }

  public async getUserFact(key: string): Promise<string | null> {
    return this.store.get(key);
  }

  public async getAllFacts(): Promise<MemoryItem[]> {
    return this.store.list();
  }

  public async buildContextPrompt(): Promise<string> {
    const items = await this.store.list();
    if (items.length === 0) return "";

    const lines = items.map((i) => `- ${i.key}: ${i.value}`);
    return `\nUser Preferences & Remembered Facts:\n${lines.join("\n")}\n`;
  }

  public async clearAll(): Promise<void> {
    await this.store.clear();
  }
}
