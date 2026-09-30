/**
 * Floating control panel. Plain DOM, no framework: a draggable glass card
 * with grouped controls. The engine hands it a `Controls` object and the
 * panel reads/writes through that so it never touches engine internals.
 */
export interface Controls {
  getMode(): "scare" | "call" | "feed";
  setMode(mode: "scare" | "call" | "feed"): void;
  palettes: readonly { id: string; label: string; blurb: string }[];
  getPalette(): string;
  setPalette(id: string): void;
  /** Custom colours as #rrggbb, keyed base/accent/marking/fin. */
  getCustomColor(key: "base" | "accent" | "marking" | "fin"): string;
  setCustomColor(key: "base" | "accent" | "marking" | "fin", hex: string): void;
  environments: readonly { id: string; label: string; blurb: string }[];
  getEnvironment(): string;
  setEnvironment(id: string): void;
  weatherIds: readonly string[];
  getWeather(): string;
  setWeather(id: string): void;
  getCount(): number;
  setCount(n: number): void;
  maxCount: number;
  scatter(): void;
  reset(): void;
  isPaused(): boolean;
  setPaused(on: boolean): void;
  getDebug(): boolean;
  setDebug(on: boolean): void;
  getSound(): boolean;
  setSound(on: boolean): void;
  getVolume(): number;
  setVolume(v: number): void;
  aquarium: {
    status(): string;
    /** Serialised pond for Undo after New pond. */
    snapshot(): unknown;
    restore(snapshot: unknown): void;
    save(): void;
    exportFile(): void;
    importFile(): Promise<boolean>;
    newPond(): void;
  };
  water: {
    getRefraction(): number;
    setRefraction(v: number): void;
    getCaustics(): number;
    setCaustics(v: number): void;
    getDamping(): number;
    setDamping(v: number): void;
  };
}

export class Panel {
  readonly root: HTMLElement;
  private readonly refreshers: (() => void)[] = [];

  constructor(private readonly c: Controls) {
    this.root = el("aside", "panel");
    this.root.innerHTML = "";

    const header = el("header", "panel-header");
    const title = el("span", "panel-title", "Koi Pond");
    title.append(el("small", "", "procedural pond · webgpu"));
    const collapse = el("button", "panel-icon", "–") as HTMLButtonElement;
    collapse.title = "Collapse";
    collapse.addEventListener("click", () => {
      this.root.classList.toggle("collapsed");
      collapse.textContent = this.root.classList.contains("collapsed") ? "+" : "–";
    });
    header.append(title, collapse);
    this.root.append(header);
    makeDraggable(this.root, header);

    const body = el("div", "panel-body");
    this.root.append(body);

    // ---- Interaction -----------------------------------------------------
    const mode = group("Tap on the water to");
    const modeChips = el("div", "chips");
    for (const [id, label] of [["scare", "Startle"], ["call", "Call the koi"], ["feed", "Toss bread"]] as const) {
      const chip = el("button", "chip", label) as HTMLButtonElement;
      chip.addEventListener("click", () => {
        c.setMode(id);
        this.refresh();
      });
      this.refreshers.push(() => chip.classList.toggle("active", c.getMode() === id));
      modeChips.append(chip);
    }
    mode.append(modeChips);
    body.append(mode);

    // ---- Environment -----------------------------------------------------
    const environment = group("Pond");
    const envChips = el("div", "chips");
    const blurb = el("p", "panel-status");
    for (const e of c.environments) {
      const chip = el("button", "chip", e.label) as HTMLButtonElement;
      chip.title = e.blurb;
      chip.addEventListener("click", () => {
        c.setEnvironment(e.id);
        this.refresh();
      });
      this.refreshers.push(() => chip.classList.toggle("active", c.getEnvironment() === e.id));
      envChips.append(chip);
    }
    this.refreshers.push(() => {
      blurb.textContent = c.environments.find((e) => e.id === c.getEnvironment())?.blurb ?? "";
    });
    environment.append(envChips, blurb);
    body.append(environment);

    // ---- Weather ---------------------------------------------------------
    const weather = group("Weather");
    const chips = el("div", "chips");
    for (const id of c.weatherIds) {
      const chip = el("button", "chip", id) as HTMLButtonElement;
      chip.addEventListener("click", () => {
        c.setWeather(id);
        this.refresh();
      });
      this.refreshers.push(() => chip.classList.toggle("active", c.getWeather() === id));
      chips.append(chip);
    }
    weather.append(chips);
    body.append(weather);

    // ---- Koi colours -------------------------------------------------------
    const colours = group("Koi colours");
    const paletteChips = el("div", "chips");
    const paletteBlurb = el("p", "panel-status");
    for (const pal of c.palettes) {
      const chip = el("button", "chip", pal.label) as HTMLButtonElement;
      chip.title = pal.blurb;
      chip.addEventListener("click", () => {
        c.setPalette(pal.id);
        this.refresh();
      });
      this.refreshers.push(() => chip.classList.toggle("active", c.getPalette() === pal.id));
      paletteChips.append(chip);
    }
    this.refreshers.push(() => {
      paletteBlurb.textContent = c.palettes.find((p) => p.id === c.getPalette())?.blurb ?? "";
    });
    const customRow = el("div", "swatches");
    for (const [key, label] of [["base", "Body"], ["accent", "Patches"], ["marking", "Markings"], ["fin", "Fins"]] as const) {
      const wrap = el("label", "swatch");
      const input = document.createElement("input");
      input.type = "color";
      input.addEventListener("input", () => {
        c.setCustomColor(key, input.value);
        if (c.getPalette() !== "custom") {
          c.setPalette("custom");
          this.refresh();
        }
      });
      this.refreshers.push(() => { input.value = c.getCustomColor(key); });
      wrap.append(input, el("span", "swatch-label", label));
      customRow.append(wrap);
    }
    this.refreshers.push(() => customRow.classList.toggle("hidden", c.getPalette() !== "custom"));
    colours.append(paletteChips, paletteBlurb, customRow);
    body.append(colours);

    // ---- Koi ---------------------------------------------------------------
    const koi = group("Koi");
    koi.append(this.slider("Count", 1, c.maxCount, 1, c.getCount, c.setCount, (v) => String(v)));
    const row = el("div", "row");
    row.append(
      button("Scatter", () => c.scatter()),
      button("Reset", () => {
        c.reset();
        this.refresh();
      }),
    );
    koi.append(row);
    koi.append(this.toggle("Pause", c.isPaused, c.setPaused));
    koi.append(this.toggle("Show spine", c.getDebug, c.setDebug));
    body.append(koi);

    // ---- Water -------------------------------------------------------------
    const water = group("Water");
    water.append(this.slider("Refraction", 0, 20, 0.1, c.water.getRefraction, c.water.setRefraction));
    water.append(this.slider("Caustics", 0, 6, 0.1, c.water.getCaustics, c.water.setCaustics));
    water.append(this.slider("Calmness", 0.95, 0.999, 0.001, c.water.getDamping, c.water.setDamping, (v) => v.toFixed(3)));
    body.append(water);

    // ---- Sound -------------------------------------------------------------
    const sound = group("Sound");
    sound.append(this.toggle("Ambient sound", c.getSound, c.setSound));
    sound.append(this.slider("Volume", 0, 1, 0.01, c.getVolume, c.setVolume, (v) => `${Math.round(v * 100)}%`));
    const credit = el("p", "panel-hint");
    credit.innerHTML = 'Ambience: <a href="https://opengameart.org/content/jc-sounds-nature-ambient-pack-vol-1" target="_blank" rel="noopener">JC Sounds</a> (CC BY 4.0) · splashes: rubberduck (CC0)';
    sound.append(credit);
    body.append(sound);

    // ---- Aquarium ----------------------------------------------------------
    const aquarium = group("Aquarium");
    const status = el("p", "panel-status");
    this.refreshers.push(() => { status.textContent = c.aquarium.status(); });
    aquarium.append(status);
    const saveRow = el("div", "row");
    saveRow.append(
      button("Save", () => { c.aquarium.save(); this.refresh(); }),
      button("Export", () => c.aquarium.exportFile()),
      button("Import", () => { void c.aquarium.importFile().then(() => this.refresh()); }),
    );
    aquarium.append(saveRow);
    const newRow = el("div", "row");
    const newBtn = button("New pond", () => {
      // Act, then offer Undo (vault: Modern Web App UI Conventions) instead of a confirm dialog.
      const snapshot = c.aquarium.snapshot();
      c.aquarium.newPond();
      this.refresh();
      this.toast("New pond started.", "Undo", () => {
        c.aquarium.restore(snapshot);
        this.refresh();
      });
    });
    newBtn.classList.add("danger");
    newRow.append(newBtn);
    aquarium.append(newRow);
    body.append(aquarium);

    const hint = el("p", "panel-hint", "Fed koi grow and are saved in this browser automatically.");
    body.append(hint);
    const keys = el("div", "keys");
    for (const [label, ks] of [["Feed on / off", ["F"]], ["Next pond", ["E"]], ["Next weather", ["W"]], ["Scatter", ["Space"]], ["Fewer / more koi", ["[", "]"]], ["Show spine", ["D"]], ["Pause", ["P"]], ["Reset", ["R"]], ["Hide panel", ["H"]]] as const) {
      keys.append(el("span", "", label));
      const k = el("span", "k");
      for (const key of ks) {
        const kbd = document.createElement("kbd");
        kbd.textContent = key;
        k.append(kbd);
      }
      keys.append(k);
    }
    body.append(keys);

    this.refresh();
  }

  private toastNode: HTMLElement | null = null;

  /** Bottom toast with one action; replaces any toast already showing. */
  toast(message: string, action: string, onAction: () => void, ms = 7000): void {
    this.toastNode?.remove();
    const node = el("div", "toast");
    node.setAttribute("role", "status");
    node.append(el("span", "", message));
    const b = el("button", "", action) as HTMLButtonElement;
    b.addEventListener("click", () => {
      onAction();
      node.remove();
    });
    node.append(b);
    document.body.append(node);
    this.toastNode = node;
    window.setTimeout(() => { if (this.toastNode === node) node.remove(); }, ms);
  }

  toggleVisible(): void {
    this.root.classList.toggle("hidden");
  }

  /** Re-read every control from the engine (after hotkeys change state). */
  refresh(): void {
    for (const r of this.refreshers) r();
  }

  private slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string = (v) => v.toFixed(1)): HTMLElement {
    const wrap = el("label", "control");
    const top = el("div", "control-top");
    const name = el("span", "control-label", label);
    const value = el("span", "control-value");
    top.append(name, value);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener("input", () => {
      set(Number(input.value));
      value.textContent = fmt(get());
    });
    this.refreshers.push(() => {
      input.value = String(get());
      value.textContent = fmt(get());
    });
    wrap.append(top, input);
    return wrap;
  }

  private toggle(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const wrap = el("label", "control toggle");
    const name = el("span", "control-label", label);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => set(input.checked));
    this.refreshers.push(() => {
      input.checked = get();
    });
    const track = el("span", "switch");
    wrap.append(name, input, track);
    return wrap;
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function group(title: string): HTMLElement {
  const section = el("section", "group");
  section.append(el("h3", "group-title", title));
  return section;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "button", label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
  let startX = 0, startY = 0, originX = 0, originY = 0;
  const move = (e: PointerEvent): void => {
    const x = Math.max(0, Math.min(window.innerWidth - 80, originX + e.clientX - startX));
    const y = Math.max(0, Math.min(window.innerHeight - 40, originY + e.clientY - startY));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.right = "auto";
  };
  handle.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    const rect = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    originX = rect.left;
    originY = rect.top;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", () => handle.removeEventListener("pointermove", move), { once: true });
  });
}
