const WALLPAPER_MANIFEST_URL = "wallpapers/manifest.json";
const DEFAULT_BACKGROUND_COLOR = "#FFFFFF";

const FALLBACK_WALLPAPERS = [
  {
    id: "wallpaper-aurora-gradient",
    name: "Aurora Gradient",
    src: "wallpapers/560817.jpg",
    preview: "wallpapers/560817.jpg",
    alt: "Purple and teal gradient wallpaper",
    size: "cover",
    position: "center center",
    repeat: "no-repeat",
    attachment: "",
    backgroundColor: "",
  },
];

const wallpaperCache = {
  items: null,
  promise: null,
};

export function createBackgroundPlugin({
  getBoardBackground,
  setBoardBackground,
  addBoardBackgroundListener,
  closePlugin,
  getPluginArea,
}) {
  let panelState = null;

  function isPanelActive() {
    return Boolean(panelState && panelState.active);
  }

  function togglePanel(hostWindow) {
    if (isPanelActive()) {
      disablePanel();
    } else {
      enablePanel();
    }

    if (hostWindow && typeof closePlugin === "function") {
      closePlugin(hostWindow);
    }
  }

  function enablePanel() {
    const pluginArea = typeof getPluginArea === "function" ? getPluginArea() : null;
    if (!pluginArea) return;

    disablePanel();

    const parts = buildPanelDom();
    pluginArea.appendChild(parts.panel);

    const state = {
      active: true,
      disposed: false,
      panel: parts.panel,
      wallpaperButtons: new Map(),
      cleanup: [],
      currentBackground: getBoardBackground(),
    };

    panelState = state;

    const { colourInput, colourValue, resetButton, removeButton, uploadInput, uploadPreview, uploadThumb, uploadName, currentLabel, wallpaperGrid, wallpaperEmpty, closeButton } = parts;

    colourInput.value = DEFAULT_BACKGROUND_COLOR;

    const focusPanel = () => {
      try {
        parts.panel.focus({ preventScroll: true });
      } catch (_error) {
        /* ignore focus errors */
      }
    };

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(focusPanel);
    } else {
      setTimeout(focusPanel, 0);
    }

    const syncUI = (background) => {
      state.currentBackground = background;
      const colour = sanitizeHex(background.color);
      colourInput.value = colour;
      colourValue.textContent = colour.toUpperCase();

      const isImage = background.mode === "image" && background.image;
      const image = isImage ? background.image : null;

      removeButton.disabled = !isImage;
      removeButton.classList.toggle("background-remove-image-disabled", !isImage);

      state.wallpaperButtons.forEach((button, id) => {
        const active = Boolean(
          image &&
            image.kind === "wallpaper" &&
            (image.id || null) === id
        );
        button.classList.toggle("is-selected", active);
      });

      if (image && image.kind === "upload") {
        uploadPreview.hidden = false;
        uploadThumb.style.backgroundImage = image.src ? `url("${image.src}")` : "";
        uploadName.textContent = image.name || "Custom image";
      } else {
        uploadPreview.hidden = true;
        uploadThumb.style.backgroundImage = "";
        uploadName.textContent = "";
      }

      if (image && image.kind === "wallpaper") {
        currentLabel.textContent = image.name ? `Current wallpaper: ${image.name}` : "Current wallpaper";
        currentLabel.hidden = false;
      } else {
        currentLabel.hidden = true;
        currentLabel.textContent = "";
      }
    };

    const colourHandler = (event) => {
      const value = sanitizeHex(event.target.value);
      const updated = setBoardBackground({ mode: "color", color: value });
      syncUI(updated);
    };

    const resetHandler = () => {
      const updated = setBoardBackground({ mode: "color", color: DEFAULT_BACKGROUND_COLOR });
      syncUI(updated);
    };

    const removeHandler = () => {
      const fallback = sanitizeHex(state.currentBackground.color);
      const updated = setBoardBackground({ mode: "color", color: fallback });
      syncUI(updated);
    };

    const uploadHandler = (event) => {
      const files = event.target.files;
      if (!files || !files.length) return;
      const file = files[0];
      if (!file || !file.type.startsWith("image/")) {
        event.target.value = "";
        return;
      }

      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        if (!result) return;
        const uploadImage = {
          id: `upload-${Date.now()}`,
          src: result,
          name: file.name || "Uploaded image",
          alt: file.name || "Uploaded image",
          kind: "upload",
          size: "cover",
          position: "center center",
          repeat: "no-repeat",
          attachment: "",
          backgroundColor: state.currentBackground.color,
        };
        const updated = setBoardBackground({ mode: "image", image: uploadImage });
        syncUI(updated);
      });
      reader.readAsDataURL(file);
      event.target.value = "";
    };

    const closeHandler = () => {
      disablePanel();
    };

    const escapeHandler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        disablePanel();
      }
    };

    colourInput.addEventListener("input", colourHandler);
    resetButton.addEventListener("click", resetHandler);
    removeButton.addEventListener("click", removeHandler);
    uploadInput.addEventListener("change", uploadHandler);
    closeButton.addEventListener("click", closeHandler);
    document.addEventListener("keydown", escapeHandler, true);

    state.cleanup.push(() => colourInput.removeEventListener("input", colourHandler));
    state.cleanup.push(() => resetButton.removeEventListener("click", resetHandler));
    state.cleanup.push(() => removeButton.removeEventListener("click", removeHandler));
    state.cleanup.push(() => uploadInput.removeEventListener("change", uploadHandler));
    state.cleanup.push(() => closeButton.removeEventListener("click", closeHandler));
    state.cleanup.push(() => document.removeEventListener("keydown", escapeHandler, true));

    const unsubscribeBackground = addBoardBackgroundListener((detail) => {
      syncUI(detail);
    });

    if (typeof unsubscribeBackground === "function") {
      state.cleanup.push(unsubscribeBackground);
    }

    loadWallpapers().then((items) => {
      if (!panelState || panelState !== state || state.disposed) return;

      state.wallpaperButtons.clear();
      wallpaperGrid.innerHTML = "";

      if (!items.length) {
        wallpaperEmpty.hidden = false;
        return;
      }

      wallpaperEmpty.hidden = true;

      items.forEach((wallpaper) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "background-wallpaper-option";
        button.dataset.wallpaperId = wallpaper.id || "";
        button.setAttribute("role", "listitem");

        const thumb = document.createElement("span");
        thumb.className = "background-wallpaper-thumb";
        thumb.setAttribute("aria-hidden", "true");
        if (wallpaper.preview || wallpaper.src) {
          thumb.style.backgroundImage = `url("${wallpaper.preview || wallpaper.src}")`;
        }

        const label = document.createElement("span");
        label.className = "background-wallpaper-label";
        label.textContent = wallpaper.name || "Wallpaper";

        button.append(thumb, label);

        const handleClick = () => {
          const updated = setBoardBackground({ mode: "image", image: { ...wallpaper } });
          syncUI(updated);
        };

        button.addEventListener("click", handleClick);
        state.cleanup.push(() => button.removeEventListener("click", handleClick));

        wallpaperGrid.appendChild(button);
        state.wallpaperButtons.set(wallpaper.id || "", button);
      });

      syncUI(getBoardBackground());
    });

    syncUI(state.currentBackground);
  }

  function disablePanel() {
    if (!panelState) return;
    const state = panelState;
    panelState = null;
    state.disposed = true;
    state.active = false;

    state.cleanup.splice(0).forEach((fn) => {
      try {
        fn();
      } catch (_error) {
        /* ignore cleanup errors */
      }
    });

    if (state.panel && state.panel.parentNode) {
      state.panel.remove();
    }
  }

  function buildPanelDom() {
    const panel = document.createElement("aside");
    panel.className = "background-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Background manager");
    panel.tabIndex = -1;
    panel.innerHTML = `
      <div class="background-panel-header">
        <h2 class="background-panel-title">Backgrounds</h2>
        <button type="button" class="background-panel-close" aria-label="Close background manager">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <div class="background-panel-content">
        <div class="background-plugin">
          <section class="background-section background-section-colour">
            <div class="background-section-header">
              <h3 class="background-section-title">Solid colour</h3>
              <button type="button" class="background-reset" aria-label="Reset to default background">Reset</button>
            </div>
            <div class="background-colour-row">
              <input type="color" class="background-colour-input" aria-label="Choose board background colour" />
              <span class="background-colour-value" aria-live="polite">${DEFAULT_BACKGROUND_COLOR}</span>
            </div>
          </section>
          <section class="background-section background-section-wallpapers">
            <h3 class="background-section-title">Wallpapers</h3>
            <div class="background-wallpaper-grid" role="list"></div>
            <p class="background-wallpaper-empty" hidden>No wallpapers available yet.</p>
          </section>
          <section class="background-section background-section-upload">
            <h3 class="background-section-title">Custom image</h3>
            <div class="background-upload-row">
              <label class="background-upload-label">
                <input type="file" accept="image/*" class="background-upload-input" />
                <span class="background-upload-trigger">Upload image</span>
              </label>
              <button type="button" class="background-remove-image" disabled>Remove</button>
            </div>
            <div class="background-upload-preview" hidden>
              <div class="background-upload-thumb" aria-hidden="true"></div>
              <div class="background-upload-meta">
                <span class="background-upload-name"></span>
                <span class="background-upload-kind">Uploaded image</span>
              </div>
            </div>
            <p class="background-current" hidden></p>
          </section>
        </div>
      </div>
    `;

    const colourInput = panel.querySelector(".background-colour-input");
    const colourValue = panel.querySelector(".background-colour-value");
    const resetButton = panel.querySelector(".background-reset");
    const removeButton = panel.querySelector(".background-remove-image");
    const uploadInput = panel.querySelector(".background-upload-input");
    const uploadPreview = panel.querySelector(".background-upload-preview");
    const uploadThumb = panel.querySelector(".background-upload-thumb");
    const uploadName = panel.querySelector(".background-upload-name");
    const currentLabel = panel.querySelector(".background-current");
    const wallpaperGrid = panel.querySelector(".background-wallpaper-grid");
    const wallpaperEmpty = panel.querySelector(".background-wallpaper-empty");
    const closeButton = panel.querySelector(".background-panel-close");

    if (
      !colourInput ||
      !colourValue ||
      !resetButton ||
      !removeButton ||
      !uploadInput ||
      !uploadPreview ||
      !uploadThumb ||
      !uploadName ||
      !currentLabel ||
      !wallpaperGrid ||
      !wallpaperEmpty ||
      !closeButton
    ) {
      throw new Error("Background panel: missing required elements");
    }

    return {
      panel,
      colourInput,
      colourValue,
      resetButton,
      removeButton,
      uploadInput,
      uploadPreview,
      uploadThumb,
      uploadName,
      currentLabel,
      wallpaperGrid,
      wallpaperEmpty,
      closeButton,
    };
  }

  function disablePanel() {
    if (!panelState) return;
    const state = panelState;
    panelState = null;
    state.disposed = true;
    state.active = false;

    state.cleanup.splice(0).forEach((fn) => {
      try {
        fn();
      } catch (_error) {
        /* ignore cleanup errors */
      }
    });

    if (state.panel && state.panel.parentNode) {
      state.panel.remove();
    }
  }

  return {
    id: "background",
    name: "Background Manager",
    icon: "fa-solid fa-image",
    hotkey: "b",
    description: "Toggle the background manager panel.",
    preferredSize: { width: 360, height: 360 },
    createContent(container) {
      const hostWindow = container.closest(".plugin-window");
      togglePanel(hostWindow);
    },
  };
}

function loadWallpapers() {
  if (Array.isArray(wallpaperCache.items)) {
    return Promise.resolve(wallpaperCache.items);
  }

  if (!wallpaperCache.promise) {
    wallpaperCache.promise = fetchManifest()
      .then((manifest) => {
        const fallbackList = FALLBACK_WALLPAPERS.map((entry, index) => normalizeWallpaperEntry(entry, index)).filter(Boolean);
        const manifestList = Array.isArray(manifest)
          ? manifest.map((entry, index) => normalizeWallpaperEntry(entry, index + fallbackList.length)).filter(Boolean)
          : [];
        const merged = mergeWallpaperLists(fallbackList, manifestList);
        wallpaperCache.items = merged;
        return merged;
      })
      .catch((error) => {
        console.warn("Background manager: failed to load manifest", error);
        const fallbackList = FALLBACK_WALLPAPERS.map((entry, index) => normalizeWallpaperEntry(entry, index)).filter(Boolean);
        wallpaperCache.items = fallbackList;
        return fallbackList;
      });
  }

  return wallpaperCache.promise;
}

function fetchManifest() {
  return fetch(WALLPAPER_MANIFEST_URL, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load wallpapers (${response.status})`);
      }
      return response.json();
    })
    .catch((error) => {
      throw error;
    });
}

function mergeWallpaperLists(base, extras) {
  const merged = [...base];
  extras.forEach((entry) => {
    if (!entry) return;
    const index = merged.findIndex((item) => item.id === entry.id);
    if (index >= 0) {
      merged[index] = entry;
    } else {
      merged.push(entry);
    }
  });
  return merged;
}

function normalizeWallpaperEntry(entry, index) {
  if (!entry) return null;
  const src = entry.src || entry.url;
  if (!src) return null;
  const id = entry.id || `wallpaper-${index}`;
  return {
    id,
    name: entry.name || `Wallpaper ${index + 1}`,
    src,
    preview: entry.preview || src,
    alt: entry.alt || entry.name || "Wallpaper",
    kind: "wallpaper",
    size: entry.size || "cover",
    position: entry.position || "center center",
    repeat: entry.repeat || "no-repeat",
    attachment: entry.attachment || "",
    backgroundColor: entry.backgroundColor || "",
  };
}

function sanitizeHex(value) {
  if (typeof value !== "string") return DEFAULT_BACKGROUND_COLOR.toUpperCase();
  const hex = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(hex)) return hex;
  if (/^[0-9A-F]{6}$/.test(hex)) return `#${hex}`;
  return DEFAULT_BACKGROUND_COLOR.toUpperCase();
}
