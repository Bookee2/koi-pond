import { Soundscape } from "./audio/soundscape";
import { FixedClock } from "./core/clock";
import { KOI, setWorldSize, WAVE, WEATHER, WORLD, worldSizeFor } from "./core/config";
import { ENVIRONMENTS, getEnvironment } from "./core/environments";
import { CUSTOM_PALETTE_ID, customPalette, getPalette, hexToRgb, PALETTES, rgbToHex } from "./core/palettes";
import { createGpu } from "./gpu/device";
import { loadKoiAtlas } from "./gpu/koi-atlas";
import { Renderer } from "./gpu/renderer";
import { loadEnvironment } from "./gpu/textures";
import { School } from "./sim/school";
import { SurfaceImpulses } from "./sim/surface";
import { applyAquarium, captureAquarium, clearBrowserSave, exportFile, importFile, loadFromBrowser, saveToBrowser, type AquariumSave } from "./sim/aquarium";
import { Panel } from "./ui/panel";

const canvas = document.getElementById("pond") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const errorBox = document.getElementById("error") as HTMLDivElement;

async function boot(): Promise<void> {
  // Render at native device resolution (capped at 4K wide) so 4K bakes show their detail.
  const fitCanvas = (): { width: number; height: number } => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.min(3840, Math.max(320, Math.round(canvas.clientWidth * dpr)));
    const height = Math.max(180, Math.round(width * (canvas.clientHeight / Math.max(1, canvas.clientWidth))));
    canvas.width = width;
    canvas.height = height;
    return { width, height };
  };
  fitCanvas();
  // Shape the world to the viewport so nothing is stretched (portrait phones get a tall pond).
  const initialWorld = worldSizeFor(canvas.width / canvas.height);
  setWorldSize(initialWorld.width, initialWorld.height);

  const gpu = await createGpu(canvas);
  const impulses = new SurfaceImpulses();
  const school = new School(impulses);
  const [atlas, env] = await Promise.all([loadKoiAtlas(gpu.device), loadEnvironment(gpu.device)]);
  const renderer = new Renderer(gpu, atlas, env);
  renderer.resize(canvas.width, canvas.height);
  let resizePending = false;
  window.addEventListener("resize", () => { resizePending = true; });
  const clock = new FixedClock(WORLD.updatesPerSecond);

  let showDebug = false;
  let weatherIndex = 0;
  let paused = false;
  let mode: "scare" | "call" | "feed" = "scare";
  let lastSaved: Date | null = null;
  let totalFed = 0;
  const sound = new Soundscape();

  school.food.onLand = (x, _y, size) => {
    impulses.push(x, _y, 1.2, -0.25 * size);
    sound.plop(0.12 * size, (x / WORLD.width) * 2 - 1);
  };
  impulses.onRainDrop = (x) => sound.drip((x / WORLD.width) * 2 - 1);
  school.food.onEaten = (x) => {
    totalFed += 1;
    sound.plop(0.22, (x / WORLD.width) * 2 - 1);
  };

  school.onBurst = (k) => {
    if (k.depth < 0.2 && Math.random() < 0.35) {
      sound.plop(0.25 + Math.random() * 0.25, (k.position.x / WORLD.width) * 2 - 1);
    }
  };

  let environmentId = "garden";
  let paletteId = "traditional";
  const customColors = { base: "#f1eadb", accent: "#dc4b2f", marking: "#27251f", fin: "#e6ddca" };
  const applyPalette = (): void => {
    renderer.setPalette(
      paletteId === CUSTOM_PALETTE_ID
        ? customPalette({ base: hexToRgb(customColors.base), accent: hexToRgb(customColors.accent), marking: hexToRgb(customColors.marking), fin: hexToRgb(customColors.fin) })
        : getPalette(paletteId),
    );
  };
  const setPalette = (id: string): void => {
    paletteId = id === CUSTOM_PALETTE_ID ? id : getPalette(id).id;
    applyPalette();
  };
  const setEnvironment = (id: string): void => {
    environmentId = getEnvironment(id).id;
    void renderer.setEnvironment(getEnvironment(environmentId));
    sound.setEnvironment(environmentId);
  };

  const setWeatherIndex = (index: number): void => {
    weatherIndex = (index + WEATHER.length) % WEATHER.length;
    renderer.setWeather(WEATHER[weatherIndex]);
  };

  const saveNow = (): void => {
    if (saveToBrowser(captureAquarium(school, WEATHER[weatherIndex].id, "My pond", environmentId, paletteId, { ...customColors }))) lastSaved = new Date();
  };
  const restore = (): boolean => {
    const save = loadFromBrowser();
    if (!save) return false;
    applyAquarium(save, school);
    const w = WEATHER.findIndex((x) => x.id === save.weather);
    if (w >= 0) setWeatherIndex(w);
    if (save.environment) setEnvironment(save.environment);
    if (save.customColors) Object.assign(customColors, save.customColors);
    if (save.palette) setPalette(save.palette);
    lastSaved = new Date(save.savedAt);
    totalFed = save.fish.reduce((sum, f) => sum + f.fed, 0);
    return true;
  };
  const aquariumStatus = (): string => {
    const biggest = school.fish.slice(0, school.count).reduce((m, k) => Math.max(m, k.growth), 1);
    const when = lastSaved ? `saved ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "not saved yet";
    return `${totalFed} crumbs eaten · biggest koi ×${biggest.toFixed(2)} · ${when}`;
  };

  const panel = new Panel({
    getMode: () => mode,
    setMode: (m) => { mode = m; },
    palettes: [...PALETTES, { id: CUSTOM_PALETTE_ID, label: "Custom", blurb: "Pick body, patch, marking and fin colours." }],
    getPalette: () => paletteId,
    setPalette,
    getCustomColor: (key) => customColors[key],
    setCustomColor: (key, hex) => {
      customColors[key] = rgbToHex(hexToRgb(hex));
      if (paletteId === CUSTOM_PALETTE_ID) applyPalette();
    },
    environments: ENVIRONMENTS,
    getEnvironment: () => environmentId,
    setEnvironment,
    aquarium: {
      status: aquariumStatus,
      snapshot: () => captureAquarium(school, WEATHER[weatherIndex].id, "My pond", environmentId, paletteId, { ...customColors }),
      restore: (snapshot) => {
        const save = snapshot as AquariumSave;
        applyAquarium(save, school);
        if (save.environment) setEnvironment(save.environment);
        if (save.customColors) Object.assign(customColors, save.customColors);
        if (save.palette) setPalette(save.palette);
        totalFed = save.fish.reduce((sum, f) => sum + f.fed, 0);
        saveNow();
      },
      save: saveNow,
      exportFile: () => exportFile(captureAquarium(school, WEATHER[weatherIndex].id, "My pond", environmentId, paletteId, { ...customColors })),
      importFile: async () => {
        const save = await importFile();
        if (!save) return false;
        applyAquarium(save, school);
        saveNow();
        return true;
      },
      newPond: () => {
        clearBrowserSave();
        school.reset();
        renderer.wave.reset();
        totalFed = 0;
        lastSaved = null;
      },
    },
    weatherIds: WEATHER.map((w) => w.id),
    getWeather: () => WEATHER[weatherIndex].id,
    setWeather: (id) => setWeatherIndex(WEATHER.findIndex((w) => w.id === id)),
    getCount: () => school.count,
    setCount: (n) => school.setCount(n),
    maxCount: KOI.maxCount,
    scatter: () => school.scatter(),
    reset: () => {
      school.reset();
      renderer.wave.reset();
    },
    isPaused: () => paused,
    setPaused: (on) => { paused = on; },
    getDebug: () => showDebug,
    setDebug: (on) => { showDebug = on; },
    getSound: () => sound.enabled,
    setSound: (on) => { void sound.setEnabled(on); },
    getVolume: () => sound.volume,
    setVolume: (v) => sound.setVolume(v),
    water: {
      getRefraction: () => WAVE.refraction,
      setRefraction: (v) => { WAVE.refraction = v; },
      getCaustics: () => WAVE.causticStrength,
      setCaustics: (v) => { WAVE.causticStrength = v; },
      getDamping: () => WAVE.damping,
      setDamping: (v) => { WAVE.damping = v; },
    },
  });
  document.body.append(panel.root);
  // Debug handle: inspect the running engine from the console.
  (window as unknown as { koi: unknown }).koi = { school, renderer, sound, impulses, panel };

  const toWorld = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WORLD.width,
      y: ((event.clientY - rect.top) / rect.height) * WORLD.height,
    };
  };

  canvas.addEventListener("pointerdown", (event) => {
    const p = toWorld(event);
    if (mode === "feed") {
      school.feed(p);
    } else if (mode === "call") {
      school.callTo(p);
      impulses.tap(p.x, p.y);
      sound.plop(1, (p.x / WORLD.width) * 2 - 1);
    } else {
      school.scare(p);
      impulses.tap(p.x, p.y);
      sound.plop(1, (p.x / WORLD.width) * 2 - 1);
    }
  });

  restore();
  // Autosave the aquarium so growth persists between visits.
  setInterval(saveNow, 15_000);
  window.addEventListener("pagehide", saveNow);

  window.addEventListener("keydown", (event) => {
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    switch (event.key) {
      case " ":
        school.scatter();
        break;
      case "d":
      case "D":
        showDebug = !showDebug;
        break;
      case "r":
      case "R":
        school.reset();
        renderer.wave.reset();
        break;
      case "w":
      case "W":
        setWeatherIndex(weatherIndex + 1);
        break;
      case "h":
      case "H":
        panel.toggleVisible();
        break;
      case "f":
      case "F":
        mode = mode === "feed" ? "scare" : "feed";
        break;
      case "e":
      case "E": {
        const i = ENVIRONMENTS.findIndex((x) => x.id === environmentId);
        setEnvironment(ENVIRONMENTS[(i + 1) % ENVIRONMENTS.length].id);
        break;
      }
      case "[":
        school.setCount(school.count - 1);
        break;
      case "]":
        school.setCount(school.count + 1);
        break;
      case "p":
      case "P":
        paused = !paused;
        break;
    }
    panel.refresh();
  });

  let frames = 0;
  let fpsTime = performance.now();
  let fps = 0;
  let previousNow = performance.now();

  const animate = (now: number): void => {
    const steps = clock.advance(now);
    const frameDt = Math.min((now - previousNow) / 1000, 0.1);
    previousNow = now;
    if (!paused) {
      for (let i = 0; i < steps; i += 1) {
        school.update(clock.step, clock.time);
        impulses.updateRain(clock.step);
      }
    }
    if (resizePending) {
      resizePending = false;
      const size = fitCanvas();
      renderer.resize(size.width, size.height);
      const world = worldSizeFor(size.width / size.height);
      if (world.width !== WORLD.width || world.height !== WORLD.height) {
        const sx = world.width / WORLD.width;
        const sy = world.height / WORLD.height;
        setWorldSize(world.width, world.height);
        school.resize(sx, sy);
        renderer.setWorld(world.width, world.height);
      }
    }
    renderer.frame(school, impulses, clock.time, frameDt, showDebug);
    sound.setRain(renderer.rainPerSecond);

    frames += 1;
    if (now - fpsTime > 500) {
      fps = Math.round((frames * 1000) / (now - fpsTime));
      frames = 0;
      fpsTime = now;
    }
    hud.textContent = `${fps} fps · ${school.count} koi · ${renderer.weatherId} · ${mode}`;
    if (frames === 0) panel.refresh();
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  errorBox.style.display = "grid";
  errorBox.textContent = `${message}\nKoi Engine needs a WebGPU browser (Chrome, Edge, or Safari 18+).`;
  console.error(error);
});
