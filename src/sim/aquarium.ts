import type { School } from "./school";

/**
 * Aquarium persistence. Fish identity is their variety plus how much they
 * have grown; positions and behaviour are regenerated on load, so a save is
 * small and stable across engine versions.
 */
export interface AquariumSave {
  version: 1;
  savedAt: string;
  name: string;
  weather: string;
  environment?: string;
  count: number;
  fish: { variety: number; growth: number; fed: number }[];
}

const STORAGE_KEY = "koi-pond.aquarium";

export function captureAquarium(school: School, weather: string, name: string, environment = "garden"): AquariumSave {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    name,
    weather,
    environment,
    count: school.count,
    fish: school.fish.map((k) => ({ variety: k.variety, growth: Number(k.growth.toFixed(4)), fed: k.fed })),
  };
}

export function applyAquarium(save: AquariumSave, school: School): void {
  school.setCount(save.count);
  save.fish.forEach((f, i) => {
    const k = school.fish[i];
    if (!k) return;
    k.variety = f.variety;
    k.fed = f.fed;
    k.setGrowth(f.growth);
  });
}

export function saveToBrowser(save: AquariumSave): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function loadFromBrowser(): AquariumSave | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AquariumSave;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function clearBrowserSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
}

export function exportFile(save: AquariumSave): void {
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${save.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "koi-pond"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importFile(): Promise<AquariumSave | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const parsed = JSON.parse(await file.text()) as AquariumSave;
        resolve(parsed.version === 1 && Array.isArray(parsed.fish) ? parsed : null);
      } catch {
        resolve(null);
      }
    });
    input.click();
  });
}
