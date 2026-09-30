import { Soundscape } from "./audio/soundscape";
import { FixedClock } from "./core/clock";
import { KOI, WAVE, WEATHER, WORLD } from "./core/config";
import { createGpu } from "./gpu/device";
import { loadKoiAtlas } from "./gpu/koi-atlas";
import { Renderer } from "./gpu/renderer";
import { loadEnvironment } from "./gpu/textures";
import { School } from "./sim/school";
import { SurfaceImpulses } from "./sim/surface";
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
  const sound = new Soundscape();

  school.onBurst = (k) => {
    if (k.depth < 0.2 && Math.random() < 0.35) {
      sound.plop(0.25 + Math.random() * 0.25, (k.position.x / WORLD.width) * 2 - 1);
    }
  };

  const setWeatherIndex = (index: number): void => {
    weatherIndex = (index + WEATHER.length) % WEATHER.length;
    renderer.setWeather(WEATHER[weatherIndex]);
  };

  const panel = new Panel({
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
    school.callTo(p);
    impulses.tap(p.x, p.y);
    sound.plop(1, (p.x / WORLD.width) * 2 - 1);
  });

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
    hud.textContent = `${fps} fps · ${school.count} koi · ${renderer.weatherId}`;
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
