import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { GuideDefinition } from "./types.js";

function isValidGuide(data: Partial<GuideDefinition>): data is GuideDefinition {
  return (
    typeof data.id === "string" &&
    typeof data.title === "string" &&
    typeof data.description === "string" &&
    typeof data.instructions === "string" &&
    Array.isArray(data.tags)
  );
}

export class GuidesLoader {
  private guides = new Map<string, GuideDefinition>();
  private readonly guidesDir: string;

  constructor(guidesDir: string) {
    this.guidesDir = guidesDir;
  }

  async load(): Promise<void> {
    let entries;
    try {
      entries = await readdir(this.guidesDir, { withFileTypes: true });
    } catch {
      console.error(`[guides] Directory not found: ${this.guidesDir} — no guides loaded`);
      return;
    }

    const jsonFiles = entries.filter(
      (e) => e.isFile() && extname(e.name) === ".json"
    );

    for (const file of jsonFiles) {
      const filePath = join(this.guidesDir, file.name);
      try {
        const raw = await readFile(filePath, "utf-8");
        const data = JSON.parse(raw) as Partial<GuideDefinition>;

        if (!isValidGuide(data)) {
          console.error(`[guides] Skipping invalid guide (missing required fields): ${file.name}`);
          continue;
        }

        this.guides.set(data.id, data);
        console.error(`[guides] Loaded: ${data.id}`);
      } catch (err) {
        console.error(`[guides] Failed to load ${file.name}:`, err);
      }
    }

    console.error(`[guides] ${this.guides.size} guide(s) loaded`);
  }

  list(): GuideDefinition[] {
    return Array.from(this.guides.values());
  }

  get(id: string): GuideDefinition | undefined {
    return this.guides.get(id);
  }
}
