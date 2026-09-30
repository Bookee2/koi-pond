import { FixedClock } from "./core/clock";
import { WEATHER, WORLD } from "./core/config";
import { createGpu } from "./gpu/device";
import { loadKoiAtlas } from "./gpu/koi-atlas";
import { Renderer } from "./gpu/renderer";
import { loadEnvironment } from "./gpu/textures";
import { School } from "./sim/school";
import { SurfaceImpulses } from "./sim/surface";

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
  });

  window.addEventListener("keydown", (event) => {
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
        weatherIndex = (weatherIndex + 1) % WEATHER.length;
        renderer.setWeather(WEATHER[weatherIndex]);
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

    frames += 1;
    if (now - fpsTime > 500) {
      fps = Math.round((frames * 1000) / (now - fpsTime));
      frames = 0;
      fpsTime = now;
    }
    hud.textContent =
      `${fps} fps · ${school.count} koi · ${renderer.weatherId}\n` +
      `click: call   space: scatter   W: weather   D: spine   [ ]: count   R: reset   P: pause`;
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
