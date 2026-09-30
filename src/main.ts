import { Soundscape } from "./audio/soundscape";
import { FixedClock } from "./core/clock";
import { KOI, WAVE, WEATHER, WORLD } from "./core/config";
import { createGpu } from "./gpu/device";
import { loadKoiAtlas } from "./gpu/koi-atlas";
import { Renderer } from "./gpu/renderer";
import { loadEnvironment } from "./gpu/textures";
import { School } from "./sim/school";
import { SurfaceImpulses } from "./sim/surface";
import { applyAquarium, captureAquarium, clearBrowserSave, exportFile, importFile, loadFromBrowser, saveToBrowser } from "./sim/aquarium";
import { Panel } from "./ui/panel";

const canvas = document.getElementById("pond") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const errorBox = document.getElementById("error") as HTMLDivElement;

async function boot(): Promise<void> {
  canvas.width = WORLD.width * WORLD.renderScale;
  canvas.height = WORLD.height * WORLD.renderScale;

  const gpu = await createGpu(canvas);
  const impulses = new SurfaceImpulses();
  const school = new School(impulses);
  const [atlas, env] = await Promise.all([loadKoiAtlas(gpu.device), loadEnvironment(gpu.device)]);
  const renderer = new Renderer(gpu, atlas, env);
  const clock = new FixedClock(WORLD.updatesPerSecond);

  let showDebug = false;
  let weatherIndex = 0;
  let paused = false;
  let mode: "call" | "feed" = "call";
  let lastSaved: Date | null = null;
  let totalFed = 0;
  const sound = new Soundscape();

  school.food.onLand = (x, _y, size) => {
    impulses.push(x, _y, 1.2, -0.25 * size);
    sound.plop(0.12 * size, (x / WORLD.width) * 2 - 1);
  };
  school.food.onEaten = (x) => {
    totalFed += 1;
    sound.plop(0.22, (x / WORLD.width) * 2 - 1);
  };

  school.onBurst = (k) => {
    if (k.depth < 0.2 && Math.random() < 0.35) {
      sound.plop(0.25 + Math.random() * 0.25, (k.position.x / WORLD.width) * 2 - 1);
    }
  };

  const setWeatherIndex = (index: number): void => {
    weatherIndex = (index + WEATHER.length) % WEATHER.length;
    renderer.setWeather(WEATHER[weatherIndex]);
  };

  const saveNow = (): void => {
    if (saveToBrowser(captureAquarium(school, WEATHER[weatherIndex].id, "My pond"))) lastSaved = new Date();
  };
  const restore = (): boolean => {
    const save = loadFromBrowser();
    if (!save) return false;
    applyAquarium(save, school);
    const w = WEATHER.findIndex((x) => x.id === save.weather);
    if (w >= 0) setWeatherIndex(w);
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
    aquarium: {
      status: aquariumStatus,
      save: saveNow,
      exportFile: () => exportFile(captureAquarium(school, WEATHER[weatherIndex].id, "My pond")),
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
    } else {
      school.callTo(p);
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
        mode = mode === "feed" ? "call" : "feed";
        break;
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
    renderer.frame(school, impulses, clock.time, frameDt, showDebug);
    sound.setRain(renderer.rainPerSecond);

    frames += 1;
    if (now - fpsTime > 500) {
      fps = Math.round((frames * 1000) / (now - fpsTime));
      frames = 0;
      fpsTime = now;
    }
    hud.textContent = `${fps} fps · ${school.count} koi · ${renderer.weatherId} · ${mode === "feed" ? "feeding" : "calling"}`;
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
