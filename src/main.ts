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
const muteButton = document.getElementById("mute") as HTMLButtonElement;
const errorBox = document.getElementById("error") as HTMLDivElement;

async function boot(): Promise<void> {
  // Render at native device resolution (capped at 4K wide) so 4K bakes show their detail.
  // The canvas can report a zero size before first layout (seen on iOS when opened from
  // another app), so fall back to the viewport and re-check every frame.
  const desiredSize = (): { width: number; height: number } => {
    const cssWidth = canvas.clientWidth || window.innerWidth || 320;
    const cssHeight = canvas.clientHeight || window.innerHeight || 568;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.min(3840, Math.max(320, Math.round(cssWidth * dpr)));
    const height = Math.max(180, Math.round(width * (cssHeight / cssWidth)));
    return { width, height };
  };
  const fitCanvas = (): { width: number; height: number } => {
    const size = desiredSize();
    canvas.width = size.width;
    canvas.height = size.height;
    return size;
  };
  fitCanvas();
  // Shape the world to the viewport so nothing is stretched (portrait phones get a tall pond).
  const initialWorld = worldSizeFor(canvas.width / canvas.height);
  setWorldSize(initialWorld.width, initialWorld.height);

  const gpu = await createGpu(canvas);
  const impulses = new SurfaceImpulses();
  const school = new School(impulses);
  // ?environment=lagoon&palette=midnight&mode=feed picks the starting look and tap action (the Capra site frames it this way).
  // A look named in the address wins over the one in a browser save.
  const params = new URLSearchParams(location.search);
  const startEnvironment = params.has("environment") ? getEnvironment(params.get("environment") ?? "") : null;
  const startPalette = params.has("palette") ? getPalette(params.get("palette") ?? "") : null;
  const [atlas, env] = await Promise.all([loadKoiAtlas(gpu.device), loadEnvironment(gpu.device, startEnvironment?.id)]);
  const renderer = new Renderer(gpu, atlas, env, { environment: startEnvironment ?? undefined, palette: startPalette ?? undefined });
  renderer.resize(canvas.width, canvas.height);
  let resizePending = false;
  const requestResize = (): void => { resizePending = true; };
  window.addEventListener("resize", requestResize);
  window.addEventListener("orientationchange", requestResize);
  window.addEventListener("pageshow", requestResize);
  window.visualViewport?.addEventListener("resize", requestResize);
  if ("ResizeObserver" in window) new ResizeObserver(requestResize).observe(canvas);
  const clock = new FixedClock(WORLD.updatesPerSecond);

  let showDebug = false;
  let weatherIndex = 0;
  let paused = false;
  // ?mode=feed (or call) picks what a tap on the water does at first.
  const startMode = params.get("mode");
  let mode: "scare" | "call" | "feed" = startMode === "feed" || startMode === "call" ? startMode : "scare";
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

  let environmentId = startEnvironment?.id ?? "garden";
  let paletteId = startPalette?.id ?? "traditional";
  sound.setEnvironment(environmentId);
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

  // Sound is on (at the soundscape's 60%) unless the visitor muted it last time. Browsers only let
  // audio start from a gesture, so it begins with the first tap; the corner button mutes it.
  const MUTE_KEY = "koi-pond-muted";
  let soundOn = ((): boolean => { try { return localStorage.getItem(MUTE_KEY) !== "1"; } catch { return true; } })();
  const showSound = (): void => {
    muteButton.setAttribute("aria-pressed", String(!soundOn));
    muteButton.ariaLabel = muteButton.title = soundOn ? "Mute sound" : "Turn sound on";
  };
  const setSound = (on: boolean): void => {
    soundOn = on;
    void sound.setEnabled(on);
    try { localStorage.setItem(MUTE_KEY, on ? "0" : "1"); } catch { /* storage blocked: the choice lasts this visit */ }
    showSound();
    panel.refresh();
  };
  showSound();
  const startSound = (event?: Event): void => {
    if (event?.target === muteButton || muteButton.contains(event?.target as Node)) return;
    if (soundOn && !sound.enabled) void sound.setEnabled(true);
  };
  if ((navigator as Navigator & { getAutoplayPolicy?: (type: string) => string }).getAutoplayPolicy?.("audiocontext") === "allowed") startSound();
  for (const type of ["pointerdown", "touchend", "keydown"] as const) {
    document.addEventListener(type, startSound, { capture: true, passive: true });
  }
  muteButton.addEventListener("click", () => setSound(!soundOn));

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
    if (save.environment && !startEnvironment) setEnvironment(save.environment);
    if (save.customColors) Object.assign(customColors, save.customColors);
    if (save.palette && !startPalette) setPalette(save.palette);
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
    getSound: () => soundOn,
    setSound,
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
  // The control panel starts collapsed so the pond shows; its + button expands it.
  panel.root.querySelector<HTMLButtonElement>(".panel-icon")?.click();
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

  /**
   * Keep the canvas, render targets and world in step with the viewport. Runs every
   * frame so a late layout (canvas reporting zero size at boot) heals on the next frame.
   */
  const syncSize = (): void => {
    const want = desiredSize();
    if (want.width !== canvas.width || want.height !== canvas.height) resizePending = true;
    if (!resizePending) return;
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
  };

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
    syncSize();
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
  // Debug: run one frame by hand (hidden tabs don't fire animation frames).
  (window as unknown as { koi: { tick?: () => void } }).koi.tick = () => {
    syncSize();
    renderer.frame(school, impulses, clock.time, 1 / 60, showDebug);
  };
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  errorBox.style.display = "grid";
  errorBox.textContent = `${message}\nKoi Engine needs a WebGPU browser (Chrome, Edge, or Safari 18+).`;
  console.error(error);
});
