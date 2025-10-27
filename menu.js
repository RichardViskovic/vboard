import { createTimerPlugin } from "./plugins/timerPlugin.js";
import { createNotepadPlugin } from "./plugins/notepadPlugin.js";
import { createBackgroundPlugin } from "./plugins/backgroundPlugin.js";

const defaultAnnotatorConfig = {
  mode: "pen",
  strokeColor: "#111827",
  fillColor: "#fbbf24",
  fillEnabled: false,
  strokeWidth: 4,
  lineCap: "round",
};

const pluginDefinitions = [
  createTimerPlugin({ setActiveWindow }),
  createNotepadPlugin(),
  createBackgroundPlugin({
    getBoardBackground,
    setBoardBackground,
    addBoardBackgroundListener,
    closePlugin,
    getPluginArea: () => state.pluginArea,
  }),
  createAnnotatorPluginDefinition(),
];

const defaultBoardBackground = Object.freeze({
  mode: "color",
  color: "#FFFFFF",
  image: null,
});

const BACKGROUND_STORAGE_KEY = "vboard.background";

const RESIZE_EDGE_THRESHOLD = 12;

function createAnnotatorPluginDefinition() {
  return {
    id: "annotator",
    name: "Annotate",
    icon: "fa-solid fa-pen-ruler",
    hotkey: "a",
    description: "Annotation mode with freehand drawing, shapes, and selection.",
    createContent(container) {
      const windowEl = container.closest(".plugin-window");
      if (!windowEl) return;
      if (state.annotatorMode?.active) {
        closePlugin(windowEl);
        disableAnnotatorMode();
        return;
      }
      enableAnnotatorMode(windowEl);
    },
  };
}

function createSvgElement(tag, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value != null) {
      element.setAttribute(key, value);
    }
  });
  return element;
}

function enableAnnotatorMode(hostWindow) {
  if (!state.pluginArea || !hostWindow) return;

  disableAnnotatorMode({ skipClose: true });

  const overlay = document.createElement("div");
  overlay.className = "annotator-overlay";
  overlay.innerHTML = '<svg class="annotator-overlay-surface" aria-hidden="true"></svg>';
  const overlaySurface = overlay.querySelector(".annotator-overlay-surface");
  state.pluginArea.appendChild(overlay);

  const toolbarParts = buildAnnotatorToolbar();
  const toolbar = toolbarParts.toolbar;
  state.pluginArea.appendChild(toolbar);

  const mode = {
    active: true,
    hostWindow,
    overlay,
    overlaySurface,
    toolbar,
    toolButtons: toolbarParts.toolButtons,
    strokeInput: toolbarParts.strokeInput,
    fillInput: toolbarParts.fillInput,
    fillToggle: toolbarParts.fillToggle,
    widthSelect: toolbarParts.widthSelect,
    capSelect: toolbarParts.capSelect,
    exitButton: toolbarParts.exitButton,
    dragHandle: toolbarParts.dragHandle,
    tool: defaultAnnotatorConfig.mode,
    strokeColor: defaultAnnotatorConfig.strokeColor,
    fillColor: defaultAnnotatorConfig.fillColor,
    fillEnabled: defaultAnnotatorConfig.fillEnabled,
    strokeWidth: defaultAnnotatorConfig.strokeWidth,
    lineCap: defaultAnnotatorConfig.lineCap,
    pointerId: null,
    drawing: null,
    resizeObserver: null,
    toolbarDrag: null,
  };

  state.annotatorMode = mode;

  overlay.addEventListener("pointerdown", handleAnnotatorPointerDown);

  mode.toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setAnnotatorTool(mode, button.dataset.tool);
    });
  });

  mode.strokeInput.addEventListener("input", (event) => {
    mode.strokeColor = event.target.value || defaultAnnotatorConfig.strokeColor;
  });

  mode.fillInput.addEventListener("input", (event) => {
    mode.fillColor = event.target.value || defaultAnnotatorConfig.fillColor;
    if (!mode.fillEnabled) {
      updateAnnotatorToolbarUI(mode);
    }
  });

  mode.fillToggle.addEventListener("click", () => {
    mode.fillEnabled = !mode.fillEnabled;
    updateAnnotatorToolbarUI(mode);
  });

  mode.widthSelect.addEventListener("change", (event) => {
    const value = parseFloat(event.target.value);
    if (!Number.isNaN(value) && value > 0) {
      mode.strokeWidth = value;
    }
  });

  mode.capSelect.addEventListener("change", (event) => {
    const capValue = event.target.value;
    if (capValue) {
      mode.lineCap = capValue;
    }
  });

  mode.exitButton.addEventListener("click", () => {
    disableAnnotatorMode();
  });

  mode.dragHandle.addEventListener("pointerdown", (event) => {
    beginAnnotatorToolbarDrag(mode, event);
  });

  hostWindow.classList.add("annotator-host-hidden");
  hostWindow.style.opacity = "0";
  hostWindow.style.pointerEvents = "none";
  hostWindow.style.width = "0px";
  hostWindow.style.height = "0px";

  hostWindow.addEventListener(
    "plugin:destroy",
    () => {
      if (state.annotatorMode && state.annotatorMode.hostWindow === hostWindow) {
        disableAnnotatorMode({ skipClose: true });
      }
    },
    { once: true }
  );

  const resizeObserver = new ResizeObserver(syncAnnotatorSurfaceSize);
  resizeObserver.observe(state.pluginArea);
  mode.resizeObserver = resizeObserver;

  syncAnnotatorSurfaceSize();
  setAnnotatorTool(mode, mode.tool);
}

function disableAnnotatorMode(options = {}) {
  const mode = state.annotatorMode;
  if (!mode || !mode.active) return;

  state.annotatorMode = null;

  document.removeEventListener("pointermove", handleAnnotatorPointerMove);
  document.removeEventListener("pointerup", handleAnnotatorPointerUp);
  document.removeEventListener("pointercancel", handleAnnotatorPointerCancel);

  if (mode.resizeObserver) {
    try {
      mode.resizeObserver.disconnect();
    } catch (_error) {
      /* ignore */
    }
  }

  if (mode.overlay) {
    mode.overlay.removeEventListener("pointerdown", handleAnnotatorPointerDown);
    mode.overlay.remove();
  }

  if (mode.toolbar) {
    mode.toolbar.remove();
  }

  mode.toolbarDrag = null;
  cancelAnnotatorDrawing();

  const hostWindow = mode.hostWindow;
  if (hostWindow) {
    hostWindow.classList.remove("annotator-host-hidden");
    hostWindow.style.opacity = "";
    hostWindow.style.pointerEvents = "";
    hostWindow.style.width = "";
    hostWindow.style.height = "";
  }

  if (!options.skipClose && hostWindow && hostWindow.isConnected) {
    closePlugin(hostWindow);
  }
}

function buildAnnotatorToolbar() {
  const toolbar = document.createElement("div");
  toolbar.className = "annotator-toolbar-floating";
  toolbar.innerHTML = `
    <div class="annotator-toolbar-header">
      <button type="button" class="annotator-toolbar-drag" data-annotator-drag aria-label="Move toolbar">
        <i class="fa-solid fa-grip-lines"></i>
      </button>
      <button type="button" class="annotator-toolbar-exit" data-annotator-exit aria-label="Exit annotation mode">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="annotator-toolbar-group" role="radiogroup" aria-label="Annotation tool">
      <button type="button" class="annotator-toolbar-btn" data-tool="pen" aria-pressed="false" aria-label="Freehand pen">
        <i class="fa-solid fa-pen"></i>
      </button>
      <button type="button" class="annotator-toolbar-btn" data-tool="line" aria-pressed="false" aria-label="Straight line">
        <i class="fa-solid fa-slash"></i>
      </button>
      <button type="button" class="annotator-toolbar-btn" data-tool="rect" aria-pressed="false" aria-label="Rectangle">
        <i class="fa-regular fa-square"></i>
      </button>
      <button type="button" class="annotator-toolbar-btn" data-tool="ellipse" aria-pressed="false" aria-label="Ellipse">
        <i class="fa-regular fa-circle"></i>
      </button>
      <button type="button" class="annotator-toolbar-btn" data-tool="select" aria-pressed="false" aria-label="Select annotations">
        <i class="fa-solid fa-arrow-pointer"></i>
      </button>
    </div>
    <label class="annotator-toolbar-field">
      <span>Stroke</span>
      <input type="color" data-annotator-stroke value="#111827" aria-label="Stroke colour" />
    </label>
    <div class="annotator-toolbar-fill">
      <label class="annotator-toolbar-field">
        <span>Fill</span>
        <input type="color" data-annotator-fill value="#fbbf24" aria-label="Fill colour" />
      </label>
      <button type="button" class="annotator-toolbar-btn annotator-toolbar-toggle" data-annotator-fill-toggle aria-pressed="false">
        Fill Off
      </button>
    </div>
    <label class="annotator-toolbar-field">
      <span>Size</span>
      <select data-annotator-width aria-label="Stroke width">
        <option value="2">Fine</option>
        <option value="4" selected>Medium</option>
        <option value="6">Bold</option>
        <option value="10">Heavy</option>
      </select>
    </label>
    <label class="annotator-toolbar-field">
      <span>Cap</span>
      <select data-annotator-cap aria-label="Stroke cap">
        <option value="round" selected>Round</option>
        <option value="butt">Flat</option>
        <option value="square">Square</option>
      </select>
    </label>
  `;

  return {
    toolbar,
    toolButtons: Array.from(toolbar.querySelectorAll("[data-tool]")),
    strokeInput: toolbar.querySelector("[data-annotator-stroke]"),
    fillInput: toolbar.querySelector("[data-annotator-fill]"),
    fillToggle: toolbar.querySelector("[data-annotator-fill-toggle]"),
    widthSelect: toolbar.querySelector("[data-annotator-width]"),
    capSelect: toolbar.querySelector("[data-annotator-cap]"),
    exitButton: toolbar.querySelector("[data-annotator-exit]"),
    dragHandle: toolbar.querySelector("[data-annotator-drag]"),
  };
}

function updateAnnotatorToolbarUI(mode) {
  if (!mode) return;
  if (mode.toolButtons) {
    mode.toolButtons.forEach((button) => {
      const isActive = button.dataset.tool === mode.tool;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      button.tabIndex = isActive ? 0 : -1;
    });
  }
  if (mode.fillToggle) {
    mode.fillToggle.setAttribute("aria-pressed", mode.fillEnabled ? "true" : "false");
    mode.fillToggle.textContent = mode.fillEnabled ? "Fill On" : "Fill Off";
  }
  updateAnnotatorOverlayCursor(mode);
}

function updateAnnotatorOverlayCursor(mode) {
  if (!mode || !mode.overlay) return;
  const selectMode = mode.tool === "select";
  mode.overlay.classList.toggle("select-mode", selectMode);
  mode.overlay.style.cursor = selectMode ? "" : "crosshair";
}

function setAnnotatorTool(mode, tool) {
  if (!mode) return;
  const nextTool = tool || defaultAnnotatorConfig.mode;
  if (mode.tool === nextTool) {
    updateAnnotatorToolbarUI(mode);
    return;
  }
  mode.tool = nextTool;
  if (nextTool === "select") {
    cancelAnnotatorDrawing();
  }
  updateAnnotatorToolbarUI(mode);
}

function getPluginAreaPoint(event) {
  const area = state.pluginArea;
  if (!area) return null;
  const rect = area.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function syncAnnotatorSurfaceSize() {
  const mode = state.annotatorMode;
  if (!mode || !mode.overlaySurface || !state.pluginArea) return;
  const rect = state.pluginArea.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  mode.overlaySurface.setAttribute("viewBox", `0 0 ${width} ${height}`);
  mode.overlaySurface.setAttribute("width", String(width));
  mode.overlaySurface.setAttribute("height", String(height));
}

function beginAnnotatorToolbarDrag(mode, event) {
  if (!mode || !mode.toolbar) return;
  const areaRect = state.pluginArea?.getBoundingClientRect();
  if (!areaRect) return;
  const toolbarRect = mode.toolbar.getBoundingClientRect();
  mode.toolbarDrag = {
    pointerId: event.pointerId ?? null,
    offsetX: event.clientX - toolbarRect.left,
    offsetY: event.clientY - toolbarRect.top,
    areaRect,
  };
  mode.toolbar.classList.add("dragging");
  document.addEventListener("pointermove", handleAnnotatorToolbarDragMove);
  document.addEventListener("pointerup", endAnnotatorToolbarDrag, { once: true });
  document.addEventListener("pointercancel", endAnnotatorToolbarDrag, { once: true });
  event.preventDefault();
}

function handleAnnotatorToolbarDragMove(event) {
  const mode = state.annotatorMode;
  if (!mode || !mode.toolbar || !mode.toolbarDrag) return;
  const { pointerId, offsetX, offsetY, areaRect } = mode.toolbarDrag;
  if (pointerId !== null && event.pointerId !== pointerId) return;
  const toolbarRect = mode.toolbar.getBoundingClientRect();
  const maxLeft = Math.max(areaRect.width - toolbarRect.width, 0);
  const maxTop = Math.max(areaRect.height - toolbarRect.height, 0);
  const nextLeft = clamp(event.clientX - areaRect.left - offsetX, 0, maxLeft);
  const nextTop = clamp(event.clientY - areaRect.top - offsetY, 0, maxTop);
  mode.toolbar.style.left = `${nextLeft}px`;
  mode.toolbar.style.top = `${nextTop}px`;
  mode.toolbar.style.right = "auto";
  mode.toolbar.style.transform = "none";
}

function endAnnotatorToolbarDrag() {
  const mode = state.annotatorMode;
  if (!mode || !mode.toolbar) return;
  document.removeEventListener("pointermove", handleAnnotatorToolbarDragMove);
  document.removeEventListener("pointerup", endAnnotatorToolbarDrag);
  document.removeEventListener("pointercancel", endAnnotatorToolbarDrag);
  mode.toolbar.classList.remove("dragging");
  mode.toolbarDrag = null;
}

function handleAnnotatorPointerDown(event) {
  const mode = state.annotatorMode;
  if (!mode || !mode.active) return;
  if (mode.tool === "select") return;
  if (event.button !== 0) return;
  const point = getPluginAreaPoint(event);
  if (!point) return;

  const drawing = createAnnotatorDrawing(mode, point);
  if (!drawing || !mode.overlaySurface) return;

  mode.pointerId = event.pointerId ?? null;
  mode.drawing = drawing;
  mode.overlaySurface.appendChild(drawing.element);
  updateAnnotatorDrawing(mode, point, { commit: true });

  document.addEventListener("pointermove", handleAnnotatorPointerMove);
  document.addEventListener("pointerup", handleAnnotatorPointerUp);
  document.addEventListener("pointercancel", handleAnnotatorPointerCancel);
  event.preventDefault();
}

function handleAnnotatorPointerMove(event) {
  const mode = state.annotatorMode;
  if (!mode || mode.pointerId === null) return;
  if (mode.pointerId !== null && event.pointerId !== mode.pointerId) return;
  const point = getPluginAreaPoint(event);
  if (!point) return;
  updateAnnotatorDrawing(mode, point);
}

function handleAnnotatorPointerUp(event) {
  const mode = state.annotatorMode;
  if (!mode || mode.pointerId === null) return;
  if (mode.pointerId !== null && event.pointerId !== mode.pointerId) return;
  const point = getPluginAreaPoint(event);
  if (point) {
    updateAnnotatorDrawing(mode, point, { commit: true });
  }
  finalizeAnnotatorDrawing(mode);
}

function handleAnnotatorPointerCancel(event) {
  const mode = state.annotatorMode;
  if (!mode || mode.pointerId === null) return;
  if (mode.pointerId !== null && event.pointerId !== mode.pointerId) return;
  cancelAnnotatorDrawing();
}

function cancelAnnotatorDrawing() {
  const mode = state.annotatorMode;
  if (!mode || !mode.drawing) {
    return;
  }
  const drawing = mode.drawing;
  if (drawing.element && drawing.element.parentNode) {
    drawing.element.parentNode.removeChild(drawing.element);
  }
  mode.drawing = null;
  mode.pointerId = null;
  document.removeEventListener("pointermove", handleAnnotatorPointerMove);
  document.removeEventListener("pointerup", handleAnnotatorPointerUp);
  document.removeEventListener("pointercancel", handleAnnotatorPointerCancel);
}

function createAnnotatorDrawing(mode, point) {
  switch (mode.tool) {
    case "pen": {
      const element = createSvgElement("path", {
        fill: "none",
        stroke: mode.strokeColor,
        "stroke-width": String(mode.strokeWidth),
        "stroke-linecap": mode.lineCap,
        "stroke-linejoin": "round",
      });
      return {
        type: "pen",
        element,
        points: [point],
      };
    }
    case "line": {
      const element = createSvgElement("line", {
        stroke: mode.strokeColor,
        "stroke-width": String(mode.strokeWidth),
        "stroke-linecap": mode.lineCap,
        fill: "none",
      });
      return {
        type: "line",
        element,
        start: { ...point },
        current: { ...point },
      };
    }
    case "rect": {
      const element = createSvgElement("rect", {
        stroke: mode.strokeColor,
        "stroke-width": String(mode.strokeWidth),
        fill: mode.fillEnabled ? mode.fillColor : "none",
        "stroke-linejoin": "round",
      });
      return {
        type: "rect",
        element,
        start: { ...point },
        current: { ...point },
      };
    }
    case "ellipse": {
      const element = createSvgElement("ellipse", {
        stroke: mode.strokeColor,
        "stroke-width": String(mode.strokeWidth),
        fill: mode.fillEnabled ? mode.fillColor : "none",
      });
      return {
        type: "ellipse",
        element,
        start: { ...point },
        current: { ...point },
      };
    }
    default:
      return null;
  }
}

function updateAnnotatorDrawing(mode, point, options = {}) {
  const drawing = mode.drawing;
  if (!drawing) return;
  const commit = options.commit === true;
  switch (drawing.type) {
    case "pen": {
      const points = drawing.points;
      if (commit || points.length === 1) {
        points.push({ ...point });
      } else {
        const last = points[points.length - 1];
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        if (dx * dx + dy * dy >= 1.5) {
          points.push({ ...point });
        } else {
          points[points.length - 1] = { ...point };
        }
      }
      const d = points
        .map((p, index) => `${index === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(" ");
      drawing.element.setAttribute("d", d);
      break;
    }
    case "line": {
      drawing.current = { ...point };
      drawing.element.setAttribute("x1", drawing.start.x.toFixed(2));
      drawing.element.setAttribute("y1", drawing.start.y.toFixed(2));
      drawing.element.setAttribute("x2", drawing.current.x.toFixed(2));
      drawing.element.setAttribute("y2", drawing.current.y.toFixed(2));
      break;
    }
    case "rect": {
      drawing.current = { ...point };
      const left = Math.min(drawing.start.x, drawing.current.x);
      const top = Math.min(drawing.start.y, drawing.current.y);
      const width = Math.abs(drawing.start.x - drawing.current.x);
      const height = Math.abs(drawing.start.y - drawing.current.y);
      drawing.element.setAttribute("x", left.toFixed(2));
      drawing.element.setAttribute("y", top.toFixed(2));
      drawing.element.setAttribute("width", Math.max(width, 0.5).toFixed(2));
      drawing.element.setAttribute("height", Math.max(height, 0.5).toFixed(2));
      break;
    }
    case "ellipse": {
      drawing.current = { ...point };
      const cx = (drawing.start.x + drawing.current.x) / 2;
      const cy = (drawing.start.y + drawing.current.y) / 2;
      const rx = Math.abs(drawing.start.x - drawing.current.x) / 2;
      const ry = Math.abs(drawing.start.y - drawing.current.y) / 2;
      drawing.element.setAttribute("cx", cx.toFixed(2));
      drawing.element.setAttribute("cy", cy.toFixed(2));
      drawing.element.setAttribute("rx", Math.max(rx, 0.5).toFixed(2));
      drawing.element.setAttribute("ry", Math.max(ry, 0.5).toFixed(2));
      break;
    }
    default:
      break;
  }
}

function finalizeAnnotatorDrawing(mode) {
  if (!mode || !mode.drawing) {
    mode.pointerId = null;
    return;
  }
  const drawing = mode.drawing;
  const shape = buildShapeDataFromDrawing(mode, drawing);
  if (drawing.element && drawing.element.parentNode) {
    drawing.element.parentNode.removeChild(drawing.element);
  }
  mode.drawing = null;
  mode.pointerId = null;
  if (shape) {
    createAnnotationWindow(shape);
  }
  document.removeEventListener("pointermove", handleAnnotatorPointerMove);
  document.removeEventListener("pointerup", handleAnnotatorPointerUp);
  document.removeEventListener("pointercancel", handleAnnotatorPointerCancel);
}

function buildShapeDataFromDrawing(mode, drawing) {
  const area = state.pluginArea;
  if (!area) return null;
  const areaRect = area.getBoundingClientRect();
  const strokeColor = mode.strokeColor;
  const strokeWidth = mode.strokeWidth;
  const lineCap = mode.lineCap;
  const fillEnabled = mode.fillEnabled;
  const fillColor = mode.fillColor;
  const padding = Math.max(4, strokeWidth * 0.75);
  let minX;
  let maxX;
  let minY;
  let maxY;
  let type = drawing.type;
  let points = null;
  if (drawing.type === "pen") {
    points = drawing.points || [];
    if (!points.length) return null;
    minX = Math.min(...points.map((p) => p.x));
    maxX = Math.max(...points.map((p) => p.x));
    minY = Math.min(...points.map((p) => p.y));
    maxY = Math.max(...points.map((p) => p.y));
    if (points.length < 2 || (maxX - minX < 1 && maxY - minY < 1)) {
      type = "dot";
    }
  } else if (drawing.type === "line") {
    const pts = [drawing.start, drawing.current];
    minX = Math.min(pts[0].x, pts[1].x);
    maxX = Math.max(pts[0].x, pts[1].x);
    minY = Math.min(pts[0].y, pts[1].y);
    maxY = Math.max(pts[0].y, pts[1].y);
  } else if (drawing.type === "rect" || drawing.type === "ellipse") {
    minX = Math.min(drawing.start.x, drawing.current.x);
    maxX = Math.max(drawing.start.x, drawing.current.x);
    minY = Math.min(drawing.start.y, drawing.current.y);
    maxY = Math.max(drawing.start.y, drawing.current.y);
  } else {
    return null;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }

  let left = minX - padding;
  let top = minY - padding;
  let width = (maxX - minX) + padding * 2;
  let height = (maxY - minY) + padding * 2;

  if (left < 0) {
    width += left * -1;
    left = 0;
  }
  if (top < 0) {
    height += top * -1;
    top = 0;
  }
  if (left + width > areaRect.width) {
    width = areaRect.width - left;
  }
  if (top + height > areaRect.height) {
    height = areaRect.height - top;
  }

  width = Math.max(width, Math.max(strokeWidth * 2, 12));
  height = Math.max(height, Math.max(strokeWidth * 2, 12));

  const shape = {
    id: ++state.annotationIdSeed,
    type,
    strokeColor,
    strokeWidth,
    lineCap,
    fillEnabled,
    fillColor: fillEnabled ? fillColor : "transparent",
    left,
    top,
    width,
    height,
  };

  const normalize = (value, origin) => value - origin;

  switch (type) {
    case "pen": {
      shape.points = points.map((p) => ({
        x: normalize(p.x, left),
        y: normalize(p.y, top),
      }));
      break;
    }
    case "dot": {
      const center = points ? points[0] : drawing.start;
      const radius = Math.max(strokeWidth / 2, 2);
      shape.cx = normalize(center.x, left);
      shape.cy = normalize(center.y, top);
      shape.radius = radius;
      break;
    }
    case "line": {
      shape.start = {
        x: normalize(drawing.start.x, left),
        y: normalize(drawing.start.y, top),
      };
      shape.end = {
        x: normalize(drawing.current.x, left),
        y: normalize(drawing.current.y, top),
      };
      break;
    }
    case "rect": {
      const rectLeft = Math.min(drawing.start.x, drawing.current.x);
      const rectTop = Math.min(drawing.start.y, drawing.current.y);
      shape.x = normalize(rectLeft, left);
      shape.y = normalize(rectTop, top);
      shape.rectWidth = Math.max(Math.abs(drawing.start.x - drawing.current.x), 1);
      shape.rectHeight = Math.max(Math.abs(drawing.start.y - drawing.current.y), 1);
      break;
    }
    case "ellipse": {
      const cx = (drawing.start.x + drawing.current.x) / 2;
      const cy = (drawing.start.y + drawing.current.y) / 2;
      const rx = Math.max(Math.abs(drawing.start.x - drawing.current.x) / 2, 1);
      const ry = Math.max(Math.abs(drawing.start.y - drawing.current.y) / 2, 1);
      shape.cx = normalize(cx, left);
      shape.cy = normalize(cy, top);
      shape.rx = rx;
      shape.ry = ry;
      break;
    }
    default:
      return null;
  }

  return shape;
}

function createAnnotationWindow(shape) {
  const template = document.getElementById("plugin-window-template");
  if (!template || !state.pluginArea) return null;
  const fragment = template.content.cloneNode(true);
  const windowEl = fragment.querySelector(".plugin-window");
  const titleEl = windowEl.querySelector(".plugin-title");
  const body = windowEl.querySelector(".plugin-body");
  const settingsBtn = windowEl.querySelector(".plugin-settings");
  const closeBtn = windowEl.querySelector(".plugin-close");

  windowEl.dataset.plugin = "annotation-shape";
  windowEl.classList.add("annotation-shape-window");
  windowEl.style.left = `${shape.left}px`;
  windowEl.style.top = `${shape.top}px`;
  windowEl.style.width = `${shape.width}px`;
  windowEl.style.height = `${shape.height}px`;
  windowEl.style.minWidth = "24px";
  windowEl.style.minHeight = "24px";
  windowEl.dataset.baseWidth = String(shape.width);
  windowEl.dataset.baseHeight = String(shape.height);
  windowEl.dataset.annotationId = String(shape.id);
  windowEl.dataset.bgColor = "transparent";

  if (settingsBtn) {
    settingsBtn.remove();
  }
  if (titleEl) {
    titleEl.textContent = "Annotation";
  }

  const svg = createSvgElement("svg", {
    class: "annotation-shape-surface",
    viewBox: `0 0 ${shape.width} ${shape.height}`,
  });
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "none");

  const shapeElement = buildAnnotationSvgElement(shape);
  if (shapeElement) {
    svg.appendChild(shapeElement);
  }
  body.appendChild(svg);

  closeBtn.addEventListener("click", () => closePlugin(windowEl));

  state.pluginArea.appendChild(windowEl);
  makeWindowInteractive(windowEl);
  initializePluginScale(windowEl);
  bringToFront(windowEl);
  state.pluginCount += 1;
  return windowEl;
}

function buildAnnotationSvgElement(shape) {
  switch (shape.type) {
    case "pen": {
      const element = createSvgElement("path", {
        d: shape.points
          .map((p, index) => `${index === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
          .join(" "),
        stroke: shape.strokeColor,
        "stroke-width": String(shape.strokeWidth),
        "stroke-linecap": shape.lineCap,
        "stroke-linejoin": "round",
        fill: "none",
      });
      return element;
    }
    case "dot": {
      const element = createSvgElement("circle", {
        cx: shape.cx.toFixed(2),
        cy: shape.cy.toFixed(2),
        r: Math.max(shape.radius, shape.strokeWidth / 2).toFixed(2),
        fill: shape.strokeColor,
        stroke: "none",
      });
      return element;
    }
    case "line": {
      const element = createSvgElement("line", {
        x1: shape.start.x.toFixed(2),
        y1: shape.start.y.toFixed(2),
        x2: shape.end.x.toFixed(2),
        y2: shape.end.y.toFixed(2),
        stroke: shape.strokeColor,
        "stroke-width": String(shape.strokeWidth),
        "stroke-linecap": shape.lineCap,
        fill: "none",
      });
      return element;
    }
    case "rect": {
      const element = createSvgElement("rect", {
        x: shape.x.toFixed(2),
        y: shape.y.toFixed(2),
        width: Math.max(shape.rectWidth, 1).toFixed(2),
        height: Math.max(shape.rectHeight, 1).toFixed(2),
        stroke: shape.strokeColor,
        "stroke-width": String(shape.strokeWidth),
        fill: shape.fillEnabled ? shape.fillColor : "none",
        "stroke-linejoin": "round",
      });
      return element;
    }
    case "ellipse": {
      const element = createSvgElement("ellipse", {
        cx: shape.cx.toFixed(2),
        cy: shape.cy.toFixed(2),
        rx: Math.max(shape.rx, 1).toFixed(2),
        ry: Math.max(shape.ry, 1).toFixed(2),
        stroke: shape.strokeColor,
        "stroke-width": String(shape.strokeWidth),
        fill: shape.fillEnabled ? shape.fillColor : "none",
      });
      return element;
    }
    default:
      return null;
  }
}

const state = {
  menuVisible: true,
  pluginCount: 0,
  zIndexSeed: 10,
  activeWindow: null,
  openPopover: null,
  pluginArea: null,
  whiteboard: null,
  boardBackground: {
    mode: "color",
    color: "#FFFFFF",
    image: null,
  },
  selectedWindows: new Set(),
  selection: null,
  annotatorMode: null,
  annotationIdSeed: 0,
};

function init() {
  const whiteboard = document.getElementById("whiteboard");
  const pluginArea = document.getElementById("plugin-area");
  const menu = document.getElementById("plugin-menu");
  const menuItems = menu?.querySelector(".menu-items");
  const template = document.getElementById("plugin-window-template");

  if (!whiteboard || !pluginArea || !menu || !menuItems || !template) {
    console.error("Whiteboard: missing required markup.");
    return;
  }

  state.whiteboard = whiteboard;
  const persistedBackground = readPersistedBoardBackground();
  if (persistedBackground) {
    state.boardBackground = cloneBoardBackground(persistedBackground);
  }
  applyBoardBackgroundStyle(state.boardBackground);
  dispatchBoardBackgroundChange(state.boardBackground);
  state.pluginArea = pluginArea;
  selectionManager.setup(pluginArea);
  buildMenu(menuItems);
  wireKeyboardShortcuts(menu);
  wireGlobalInteractions();
  toggleMenu(true);

  menuItems.addEventListener("click", (event) => {
    const item = event.target.closest("[data-plugin-id]");
    if (!item) return;
    const pluginId = item.dataset.pluginId;
    const def = pluginDefinitions.find((plugin) => plugin.id === pluginId);
    if (def) {
      spawnPlugin(def, pluginArea, template);
    }
  });
}

function buildMenu(menuItems) {
  pluginDefinitions.forEach((plugin) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item";
    button.dataset.pluginId = plugin.id;
    button.title = `${plugin.name} (${plugin.hotkey.toUpperCase()}): ${plugin.description}`;
    button.setAttribute(
      "aria-label",
      `${plugin.name} (${plugin.hotkey.toUpperCase()}) - ${plugin.description}`
    );
    button.innerHTML = `
      <span class="menu-icon">
        <i class="${plugin.icon}" aria-hidden="true"></i>
      </span>
      <span class="menu-tooltip" role="presentation">
        <span class="menu-tooltip-title">${plugin.name}</span>
        <span class="menu-tooltip-hotkey">${plugin.hotkey.toUpperCase()}</span>
      </span>
    `;
    menuItems.appendChild(button);
  });
}

function spawnPlugin(definition, pluginArea, template) {
  if (definition.id === "annotator" && state.annotatorMode?.active) {
    disableAnnotatorMode();
    return;
  }

  const fragment = template.content.cloneNode(true);
  const windowEl = fragment.querySelector(".plugin-window");
  const titleEl = windowEl.querySelector(".plugin-title");
  const closeBtn = windowEl.querySelector(".plugin-close");
  const body = windowEl.querySelector(".plugin-body");
  const settingsBtn = windowEl.querySelector(".plugin-settings");

  windowEl.dataset.plugin = definition.id;
  windowEl.style.minWidth = "200px";
  windowEl.style.minHeight = "150px";
  if (definition.preferredSize) {
    windowEl.style.width = `${definition.preferredSize.width}px`;
    windowEl.style.height = `${definition.preferredSize.height}px`;
  }

  positionNewWindow(windowEl);
  makeWindowInteractive(windowEl);

  titleEl.textContent = definition.name;
  definition.createContent(body);

  const {
    popover,
    colorInput,
    clearButton,
    pluginSection,
    syncInputs,
  } = createSettingsPopover(windowEl, definition);

  windowEl.dataset.bgColor = "transparent";
  applyPluginBackground(windowEl, "transparent");

  closeBtn.addEventListener("click", () => closePlugin(windowEl));
  settingsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setActiveWindow(windowEl);
    if (typeof syncInputs === "function") {
      syncInputs();
    }
    toggleSettingsPopover(windowEl, popover, colorInput);
  });

  colorInput.addEventListener("input", (event) => {
    const chosenColor = event.target.value;
    windowEl.dataset.lastBgColor = chosenColor;
    applyPluginBackground(windowEl, chosenColor);
  });

  clearButton.addEventListener("click", (event) => {
    event.preventDefault();
    applyPluginBackground(windowEl, "transparent");
    windowEl.dataset.lastBgColor = "";
    colorInput.value = "#ffffff";
    closeOpenPopover();
  });

  settingsBtn.after(popover);

  pluginArea.appendChild(windowEl);
  setActiveWindow(windowEl);
  initializePluginScale(windowEl);
  state.pluginCount += 1;
}

function positionNewWindow(windowEl) {
  const step = 24;
  const maxOffset = 5;
  const offsetIndex = state.pluginCount % maxOffset;
  windowEl.style.left = `${32 + step * offsetIndex}px`;
  windowEl.style.top = `${32 + step * offsetIndex}px`;
}

function getResizeDirections(windowEl, clientX, clientY) {
  if (!windowEl || typeof windowEl.getBoundingClientRect !== "function") return null;
  const rect = windowEl.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  const offsetX = clientX - rect.left;
  const offsetY = clientY - rect.top;
  if (Number.isNaN(offsetX) || Number.isNaN(offsetY)) return null;

  const withinBounds =
    offsetX >= 0 && offsetY >= 0 && offsetX <= rect.width && offsetY <= rect.height;
  if (!withinBounds) return null;

  const directions = {
    north: offsetY <= RESIZE_EDGE_THRESHOLD,
    south: rect.height - offsetY <= RESIZE_EDGE_THRESHOLD,
    west: offsetX <= RESIZE_EDGE_THRESHOLD,
    east: rect.width - offsetX <= RESIZE_EDGE_THRESHOLD,
  };

  if (!directions.north && !directions.south && !directions.west && !directions.east) {
    return null;
  }

  return directions;
}

function directionsToCursor(directions) {
  if (!directions) return "";
  const { north, south, east, west } = directions;

  if ((north && west) || (south && east)) return "nwse-resize";
  if ((north && east) || (south && west)) return "nesw-resize";
  if (east || west) return "ew-resize";
  if (north || south) return "ns-resize";
  return "";
}

function applyResizeCursor(cursor, windowEl) {
  if (windowEl && windowEl.style) {
    windowEl.style.cursor = cursor || "";
  }
  const area = state.pluginArea;
  if (area && area.style) {
    area.style.cursor = cursor || "";
  }
  const bodyStyle = document?.body?.style;
  if (bodyStyle) {
    bodyStyle.cursor = cursor || "";
  }
}

function clearResizeCursor(windowEl) {
  applyResizeCursor("", windowEl);
}

function makeWindowInteractive(windowEl) {
  const header = windowEl.querySelector(".plugin-header");
  const handleHoverForResize = (event) => {
    if (windowEl.dataset.resizing === "true") return;
    if (event.buttons === 1) return;
    const directions = getResizeDirections(windowEl, event.clientX, event.clientY);
    const cursor = directionsToCursor(directions);
    windowEl.style.cursor = cursor;
  };

  const clearHoverCursor = () => {
    if (windowEl.dataset.resizing === "true") return;
    windowEl.style.cursor = "";
  };

  windowEl.addEventListener("pointermove", handleHoverForResize);
  windowEl.addEventListener("pointerleave", clearHoverCursor);

  windowEl.addEventListener("pointerdown", (event) => {
    const preserveSelection =
      state.selectedWindows &&
      state.selectedWindows.size > 1 &&
      state.selectedWindows.has(windowEl);

    const isButton = Boolean(event.target.closest("button"));
    const inPopover = Boolean(event.target.closest(".plugin-settings-popover"));
    const resizeDirections =
      !inPopover && !isButton
        ? getResizeDirections(windowEl, event.clientX, event.clientY)
        : null;

    if (resizeDirections) {
      event.preventDefault();
      event.stopPropagation();
      setActiveWindow(windowEl, { preserveSelection });
      if (preserveSelection) {
        selectionManager.bringToFront();
      }
      startResize(windowEl, event, resizeDirections);
      return;
    }

    if (event.target.closest(".timer-controls")) {
      return;
    }

    setActiveWindow(windowEl, { preserveSelection });
    if (preserveSelection) {
      selectionManager.bringToFront();
    }
  });
  windowEl.addEventListener("focusin", (event) => {
    if (event.target.closest(".timer-controls")) return;
    setActiveWindow(windowEl);
  });

  if (header) {
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const preserveSelection =
        state.selectedWindows &&
        state.selectedWindows.size > 1 &&
        state.selectedWindows.has(windowEl);

      const resizeDirections = getResizeDirections(
        windowEl,
        event.clientX,
        event.clientY
      );
      if (resizeDirections) {
        event.preventDefault();
        event.stopPropagation();
        setActiveWindow(windowEl, { preserveSelection });
        if (preserveSelection) {
          selectionManager.bringToFront();
        }
        startResize(windowEl, event, resizeDirections);
        return;
      }

      event.preventDefault();
      setActiveWindow(windowEl, { preserveSelection });
      if (preserveSelection) {
        selectionManager.bringToFront();
      }
      startDrag(windowEl, event);
    });
  }

}

function startDrag(windowEl, pointerEvent) {
  if (
    state.selectedWindows &&
    state.selectedWindows.size > 1 &&
    state.selectedWindows.has(windowEl)
  ) {
    startGroupDrag(windowEl, pointerEvent);
    return;
  }

  const rect = windowEl.getBoundingClientRect();
  const parentRect = windowEl.parentElement.getBoundingClientRect();
  const offsetX = pointerEvent.clientX - rect.left;
  const offsetY = pointerEvent.clientY - rect.top;

  const handleMove = (event) => {
    event.preventDefault();
    const x = Math.max(0, event.clientX - offsetX - parentRect.left);
    const y = Math.max(0, event.clientY - offsetY - parentRect.top);
    windowEl.style.left = `${x}px`;
    windowEl.style.top = `${y}px`;
  };

  const stopDrag = () => {
    document.removeEventListener("pointermove", handleMove);
    document.removeEventListener("pointerup", stopDrag);
  };

  document.addEventListener("pointermove", handleMove);
  document.addEventListener("pointerup", stopDrag, { once: true });
}

function startGroupDrag(anchorWindow, pointerEvent) {
  const pluginArea = state.pluginArea;
  if (!pluginArea || !state.selectedWindows || state.selectedWindows.size === 0) {
    return;
  }

  pointerEvent.preventDefault();

  const pointerId =
    pointerEvent.pointerId !== undefined ? pointerEvent.pointerId : null;
  if (pointerId !== null && anchorWindow.setPointerCapture) {
    try {
      anchorWindow.setPointerCapture(pointerId);
    } catch (_error) {
      /* ignore inability to capture pointer */
    }
  }

  const areaRect = pluginArea.getBoundingClientRect();
  const startX = pointerEvent.clientX;
  const startY = pointerEvent.clientY;

  const windows = Array.from(state.selectedWindows);
  if (!windows.includes(anchorWindow)) {
    windows.push(anchorWindow);
  }

  const windowData = windows.map((windowEl) => {
    const rect = windowEl.getBoundingClientRect();
    return {
      el: windowEl,
      startLeft: rect.left - areaRect.left,
      startTop: rect.top - areaRect.top,
      width: rect.width,
      height: rect.height,
    };
  });

  bringSelectionToFront();

  const handleMove = (event) => {
    event.preventDefault();
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    windowData.forEach((data) => {
      const maxLeft = Math.max(areaRect.width - data.width, 0);
      const maxTop = Math.max(areaRect.height - data.height, 0);
      const nextLeft = clamp(data.startLeft + deltaX, 0, maxLeft);
      const nextTop = clamp(data.startTop + deltaY, 0, maxTop);
      data.el.style.left = `${nextLeft}px`;
      data.el.style.top = `${nextTop}px`;
    });
  };

  const handleUp = () => {
    document.removeEventListener("pointermove", handleMove);
    document.removeEventListener("pointerup", handleUp);
    if (pointerId !== null && anchorWindow.releasePointerCapture) {
      try {
        anchorWindow.releasePointerCapture(pointerId);
      } catch (_error) {
        /* ignore inability to release pointer */
      }
    }
  };

  document.addEventListener("pointermove", handleMove);
  document.addEventListener("pointerup", handleUp, { once: true });
}

function startResize(windowEl, pointerEvent, directions = null) {
  const rect = windowEl.getBoundingClientRect();
  const minWidth = parseFloat(windowEl.style.minWidth) || 200;
  const minHeight = parseFloat(windowEl.style.minHeight) || 150;
  const startWidth = rect.width;
  const startHeight = rect.height;
  const startX = pointerEvent.clientX;
  const startY = pointerEvent.clientY;

  const parentRect = windowEl.parentElement?.getBoundingClientRect() ?? null;
  const startLeft = parentRect ? rect.left - parentRect.left : parseFloat(windowEl.style.left) || 0;
  const startTop = parentRect ? rect.top - parentRect.top : parseFloat(windowEl.style.top) || 0;

  const resizeDirections =
    directions ||
    {
      east: true,
      south: true,
      north: false,
      west: false,
    };

  const pointerId = pointerEvent.pointerId ?? null;
  if (pointerId !== null && typeof windowEl.setPointerCapture === "function") {
    try {
      windowEl.setPointerCapture(pointerId);
    } catch (_error) {
      /* ignore inability to capture pointer */
    }
  }

  const cursor = directionsToCursor(resizeDirections);
  if (cursor) {
    applyResizeCursor(cursor, windowEl);
  }
  windowEl.dataset.resizing = "true";

  const handleMove = (event) => {
    event.preventDefault();
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    let nextWidth = startWidth;
    let nextHeight = startHeight;
    let nextLeft = startLeft;
    let nextTop = startTop;

    if (resizeDirections.east) {
      nextWidth = Math.max(minWidth, startWidth + deltaX);
    }
    if (resizeDirections.south) {
      nextHeight = Math.max(minHeight, startHeight + deltaY);
    }
    if (resizeDirections.west) {
      const proposedWidth = Math.max(minWidth, startWidth - deltaX);
      const widthDelta = startWidth - proposedWidth;
      nextLeft = startLeft + widthDelta;
      nextWidth = proposedWidth;
    }
    if (resizeDirections.north) {
      const proposedHeight = Math.max(minHeight, startHeight - deltaY);
      const heightDelta = startHeight - proposedHeight;
      nextTop = startTop + heightDelta;
      nextHeight = proposedHeight;
    }

    if (parentRect) {
      if (nextLeft < 0) {
        const overshoot = -nextLeft;
        nextLeft = 0;
        if (resizeDirections.west) {
          nextWidth = Math.min(
            Math.max(minWidth, nextWidth - overshoot),
            parentRect.width
          );
        }
      }
      if (nextTop < 0) {
        const overshoot = -nextTop;
        nextTop = 0;
        if (resizeDirections.north) {
          nextHeight = Math.min(
            Math.max(minHeight, nextHeight - overshoot),
            parentRect.height
          );
        }
      }

      const maxWidth = Math.max(parentRect.width - nextLeft, minWidth);
      nextWidth = clamp(nextWidth, minWidth, maxWidth);
      const maxHeight = Math.max(parentRect.height - nextTop, minHeight);
      nextHeight = clamp(nextHeight, minHeight, maxHeight);
    }

    windowEl.style.left = `${nextLeft}px`;
    windowEl.style.top = `${nextTop}px`;
    windowEl.style.width = `${nextWidth}px`;
    windowEl.style.height = `${nextHeight}px`;
    updatePluginScale(windowEl);
  };

  const stopResize = () => {
    document.removeEventListener("pointermove", handleMove);
    document.removeEventListener("pointerup", stopResize);
    if (pointerId !== null && typeof windowEl.releasePointerCapture === "function") {
      try {
        windowEl.releasePointerCapture(pointerId);
      } catch (_error) {
        /* ignore inability to release pointer */
      }
    }
    delete windowEl.dataset.resizing;
    clearResizeCursor(windowEl);
    updatePluginScale(windowEl);
  };

  document.addEventListener("pointermove", handleMove);
  document.addEventListener("pointerup", stopResize, { once: true });
}

function bringToFront(windowEl) {
  state.zIndexSeed += 1;
  windowEl.style.zIndex = state.zIndexSeed;
}

function wireKeyboardShortcuts(menu) {
  document.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    const editingContext = isEditableTarget(event.target);

    if (editingContext && key !== "escape") {
      return;
    }

    if (key === "escape") {
      if (state.annotatorMode?.active) {
        if (state.annotatorMode.drawing) {
          cancelAnnotatorDrawing();
          return;
        }
        disableAnnotatorMode();
        return;
      }
      if (state.openPopover) {
        closeOpenPopover();
        return;
      }
      const activeWindows = document.querySelectorAll(".plugin-window.active");
      activeWindows.forEach((windowEl) => {
        handleWindowDeactivated(windowEl);
        windowEl.classList.remove("active");
        updatePluginScale(windowEl);
      });
      state.activeWindow = null;
      selectionManager.clear();
      return;
    }

    if (key === "delete") {
      if (state.openPopover) {
        closeOpenPopover();
        return;
      }
      if (editingContext) return;
      if (state.selectedWindows && state.selectedWindows.size) {
        event.preventDefault();
        selectionManager.deleteSelected();
        return;
      }
      if (state.activeWindow) {
        event.preventDefault();
        closePlugin(state.activeWindow);
      }
      return;
    }

    if (key === "m") {
      event.preventDefault();
      toggleMenu(!state.menuVisible, menu);
      return;
    }

    if (!state.menuVisible || key.length !== 1) return;
    if (editingContext) return;

    const hotkeyMatch = pluginDefinitions.find(
      (plugin) => plugin.hotkey === key
    );

    if (!hotkeyMatch) return;

    const menuItems = menu.querySelector(".menu-items");
    const targetButton = menuItems.querySelector(
      `[data-plugin-id="${hotkeyMatch.id}"]`
    );
    if (targetButton) {
      targetButton.click();
    }
  });
}

function toggleMenu(show, menuElement = document.getElementById("plugin-menu")) {
  if (!menuElement) return;
  const nextState = typeof show === "boolean" ? show : !state.menuVisible;
  state.menuVisible = nextState;
  menuElement.classList.toggle("hidden", !nextState);
}

function wireGlobalInteractions() {
  document.addEventListener("pointerdown", (event) => {
    const targetWindow = event.target.closest(".plugin-window");
    const withinMenu = event.target.closest(".plugin-menu");

    if (!targetWindow && !withinMenu) {
      if (!state.selection || !state.selection.active) {
        selectionManager.clear();
      }
      setActiveWindow(null);
    }

    if (
      state.openPopover &&
      (!targetWindow || !state.openPopover.contains(event.target))
    ) {
      closeOpenPopover();
    }
  });
}

function createSettingsPopover(windowEl, definition) {
  const popover = document.createElement("div");
  popover.className = "plugin-settings-popover";
  const backgroundRow = document.createElement("label");
  backgroundRow.className = "settings-row";
  backgroundRow.innerHTML = `
    <span>Background</span>
    <input type="color" value="#ffffff" aria-label="Plugin background colour" />
  `;
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "plugin-bg-clear";
  clearButton.textContent = "Transparent";

  popover.append(backgroundRow, clearButton);

  const pluginSection = document.createElement("div");
  pluginSection.className = "settings-plugin-section";
  popover.appendChild(pluginSection);

  popover.addEventListener("pointerdown", (event) => event.stopPropagation());

  const colorInput = popover.querySelector('input[type="color"]');
  let pluginSync = null;
  let pluginTeardown = null;

  if (definition && typeof definition.createSettings === "function") {
    const pluginSettings = definition.createSettings({
      windowEl,
      container: pluginSection,
    });
    if (pluginSettings) {
      if (typeof pluginSettings.sync === "function") {
        pluginSync = pluginSettings.sync;
      }
      if (typeof pluginSettings.teardown === "function") {
        pluginTeardown = pluginSettings.teardown;
      }
    }
  }

  if (pluginTeardown) {
    windowEl._settingsTeardown = pluginTeardown;
  }

  const syncInputs = () => {
    const currentColor = windowEl.dataset.bgColor;
    const fallback = windowEl.dataset.lastBgColor || "#ffffff";
    if (currentColor && currentColor !== "transparent") {
      colorInput.value = currentColor;
    } else if (fallback) {
      colorInput.value = fallback;
    }
    if (pluginSync) pluginSync();
  };

  return { popover, colorInput, clearButton, pluginSection, syncInputs };
}

function toggleSettingsPopover(windowEl, popover, colorInput) {
  if (!popover) return;

  if (state.openPopover && state.openPopover !== popover) {
    state.openPopover.classList.remove("open");
    state.openPopover = null;
  }

  const shouldOpen = !popover.classList.contains("open");

  if (shouldOpen) {
    const currentColor = windowEl.dataset.bgColor;
    const fallback = windowEl.dataset.lastBgColor || "#ffffff";
    if (currentColor && currentColor !== "transparent") {
      colorInput.value = currentColor;
    } else if (fallback) {
      colorInput.value = fallback;
    }
    popover.classList.add("open");
    state.openPopover = popover;
  } else {
    popover.classList.remove("open");
    state.openPopover = null;
  }
}

function applyPluginBackground(windowEl, color) {
  const body = windowEl.querySelector(".plugin-body");
  if (!body) return;

  if (color === "transparent") {
    body.style.backgroundColor = "transparent";
    windowEl.dataset.bgColor = "transparent";
  } else {
    body.style.backgroundColor = color;
    windowEl.dataset.bgColor = color;
    windowEl.dataset.lastBgColor = color;
  }
}

function handleWindowDeactivated(windowEl) {
  if (!windowEl) return;
  if (windowEl.dataset?.plugin === "notepad") {
    const editor = windowEl._notepadState?.editor;
    if (editor) {
      if (document.activeElement === editor) {
        editor.blur();
      } else {
        editor.classList.remove("focused");
        windowEl._notepadState?.ensurePlaceholder?.();
      }
    }
  }
}

function closePlugin(windowEl) {
  if (!windowEl) return;
  if (windowEl._pluginObserver) {
    windowEl._pluginObserver.disconnect();
    delete windowEl._pluginObserver;
  }
  if (typeof windowEl._settingsTeardown === "function") {
    try {
      windowEl._settingsTeardown();
    } finally {
      delete windowEl._settingsTeardown;
    }
  }
  if (state.selectedWindows && state.selectedWindows.has(windowEl)) {
    state.selectedWindows.delete(windowEl);
    windowEl.classList.remove("selected");
  }
  if (state.annotatorMode && state.annotatorMode.hostWindow === windowEl) {
    disableAnnotatorMode({ skipClose: true });
  }
  handleWindowDeactivated(windowEl);
  if (windowEl._notepadState) {
    delete windowEl._notepadState;
  }
  if (state.activeWindow === windowEl) {
    setActiveWindow(null);
  }
  windowEl.dispatchEvent(
    new CustomEvent("plugin:destroy", { bubbles: false, cancelable: false })
  );
  windowEl.remove();
}

function closeOpenPopover() {
  if (!state.openPopover) return;
  state.openPopover.classList.remove("open");
  state.openPopover = null;
}

function setActiveWindow(windowEl, options = {}) {
  const { preserveSelection = false } = options;
  if (state.activeWindow === windowEl) return;

  const previousActive =
    state.activeWindow && document.body.contains(state.activeWindow)
      ? state.activeWindow
      : null;

  if (
    !preserveSelection &&
    windowEl &&
    state.selectedWindows &&
    state.selectedWindows.size
  ) {
    selectionManager.clear();
  }

  if (previousActive) {
    handleWindowDeactivated(previousActive);
    previousActive.classList.remove("active");
    updatePluginScale(previousActive);
  }

  if (state.openPopover) {
    closeOpenPopover();
  }

  state.activeWindow =
    windowEl && document.body.contains(windowEl) ? windowEl : null;

  if (state.activeWindow) {
    state.activeWindow.classList.add("active");
    bringToFront(state.activeWindow);
    updatePluginScale(state.activeWindow);
  }
}

function initializePluginScale(windowEl) {
  if (!windowEl) return;

  const setupScale = () => {
    if (!windowEl.isConnected) return;
    const measurementTarget = getScaleMeasurementTarget(windowEl);

    if (!windowEl.dataset.baseWidth || !windowEl.dataset.baseHeight) {
      const currentWidth = measurementTarget?.offsetWidth || 0;
      const currentHeight = measurementTarget?.offsetHeight || 0;
      if (currentWidth > 0 && currentHeight > 0) {
        windowEl.dataset.baseWidth = currentWidth;
        windowEl.dataset.baseHeight = currentHeight;
      } else {
        setTimeout(setupScale, 32);
        return;
      }
    }

    updatePluginScale(windowEl);

    if (
      typeof ResizeObserver === "function" &&
      !windowEl._pluginObserver &&
      measurementTarget
    ) {
      const observer = new ResizeObserver(() => updatePluginScale(windowEl));
      observer.observe(measurementTarget);
      windowEl._pluginObserver = observer;
    }
  };

  if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
    window.requestAnimationFrame(setupScale);
  } else {
    setTimeout(setupScale, 0);
  }
}

function updatePluginScale(windowEl) {
  if (!windowEl) return;
  const baseWidth = parseFloat(windowEl.dataset.baseWidth);
  const baseHeight = parseFloat(windowEl.dataset.baseHeight);
  if (!baseWidth || !baseHeight) return;

  const measurementTarget = getScaleMeasurementTarget(windowEl);
  if (!measurementTarget) return;

  const currentWidth = measurementTarget.offsetWidth;
  const currentHeight = measurementTarget.offsetHeight;
  if (!currentWidth || !currentHeight) return;

  const isActive = windowEl.classList.contains("active");
  const lastWidth = parseFloat(windowEl.dataset.lastBodyWidth || "0");
  const lastHeight = parseFloat(windowEl.dataset.lastBodyHeight || "0");
  const lastWindowWidth = parseFloat(windowEl.dataset.lastWindowWidth || "0");
  const lastWindowHeight = parseFloat(windowEl.dataset.lastWindowHeight || "0");

  const jitterThreshold = 6;
  const measurementTolerance = 0.75;

  let windowRect = null;
  if (typeof windowEl.getBoundingClientRect === "function") {
    try {
      windowRect = windowEl.getBoundingClientRect();
    } catch (_error) {
      windowRect = null;
    }
  }
  const windowWidth = windowRect?.width ?? Number.NaN;
  const windowHeight = windowRect?.height ?? Number.NaN;

  let effectiveWidth = currentWidth;
  let effectiveHeight = currentHeight;

  if (!isActive && lastWidth > 0) {
    const widthChange = currentWidth - lastWidth;
    const windowChange = !Number.isNaN(windowWidth)
      ? windowWidth - (lastWindowWidth || lastWidth)
      : widthChange;

    if (
      Math.abs(widthChange) <= jitterThreshold ||
      Math.abs(windowChange) <= measurementTolerance
    ) {
      effectiveWidth = lastWidth;
    }
  }

  if (!isActive && lastHeight > 0) {
    const heightChange = currentHeight - lastHeight;
    const windowHeightChange = !Number.isNaN(windowHeight)
      ? windowHeight - (lastWindowHeight || lastHeight)
      : heightChange;

    if (
      Math.abs(heightChange) <= jitterThreshold ||
      Math.abs(windowHeightChange) <= measurementTolerance
    ) {
      effectiveHeight = lastHeight;
    }
  }

  const scaleX = effectiveWidth / baseWidth;
  const scaleY = effectiveHeight / baseHeight;
  const rawScale = Math.min(scaleX, scaleY);
  const clampedScale = Math.max(0.35, Math.min(6, rawScale));

  windowEl.style.setProperty("--plugin-scale", clampedScale.toFixed(3));
  windowEl.style.setProperty("--plugin-width", `${effectiveWidth}px`);
  windowEl.style.setProperty("--plugin-height", `${effectiveHeight}px`);

  windowEl.dataset.lastBodyWidth = String(effectiveWidth);
  windowEl.dataset.lastBodyHeight = String(effectiveHeight);
  if (!Number.isNaN(windowWidth) && windowWidth > 0) {
    windowEl.dataset.lastWindowWidth = String(windowWidth);
  }
  if (!Number.isNaN(windowHeight) && windowHeight > 0) {
    windowEl.dataset.lastWindowHeight = String(windowHeight);
  }
}

function getScaleMeasurementTarget(windowEl) {
  if (!windowEl) return null;
  if (
    windowEl.classList &&
    typeof windowEl.classList.contains === "function" &&
    windowEl.classList.contains("annotation-shape-window")
  ) {
    return windowEl;
  }
  return windowEl.querySelector(".plugin-body") || windowEl;
}

function cloneBoardBackground(background) {
  const source = background ?? defaultBoardBackground;
  const image = source && source.image ? { ...source.image } : null;
  return {
    mode: source?.mode || "color",
    color: source?.color || defaultBoardBackground.color,
    image,
  };
}

function normalizeBackgroundImage(image) {
  if (!image || !image.src) return null;
  return {
    id: image.id ?? null,
    src: image.src,
    name: image.name || "",
    alt: image.alt || "",
    kind: image.kind || "wallpaper",
    size: image.size || "cover",
    position: image.position || "center center",
    repeat: image.repeat || "no-repeat",
    attachment: image.attachment || "",
    backgroundColor: image.backgroundColor || "",
  };
}

function backgroundImagesEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.src === b.src &&
    a.size === b.size &&
    a.position === b.position &&
    a.repeat === b.repeat &&
    a.attachment === b.attachment &&
    a.backgroundColor === b.backgroundColor &&
    a.kind === b.kind &&
    a.name === b.name &&
    a.id === b.id
  );
}

function getBoardBackground() {
  return cloneBoardBackground(state.boardBackground);
}

function setBoardBackground(update, options = {}) {
  if (!update) return getBoardBackground();
  const previous = cloneBoardBackground(state.boardBackground);
  const next = cloneBoardBackground(previous);

  if (update.mode) {
    next.mode = update.mode;
  }

  if (Object.prototype.hasOwnProperty.call(update, "color")) {
    if (typeof update.color === "string") {
      const trimmed = update.color.trim().toUpperCase();
      next.color = /^#[0-9A-F]{6}$/.test(trimmed)
        ? trimmed
        : defaultBoardBackground.color;
    } else {
      next.color = defaultBoardBackground.color;
    }
  }

  if (Object.prototype.hasOwnProperty.call(update, "image")) {
    next.image = normalizeBackgroundImage(update.image);
  }

  if (next.mode !== "image" || !next.image) {
    next.mode = "color";
    next.image = null;
  }

  const changed =
    next.mode !== previous.mode ||
    next.color !== previous.color ||
    !backgroundImagesEqual(next.image, previous.image);

  state.boardBackground = cloneBoardBackground(next);
  applyBoardBackgroundStyle(state.boardBackground);

  if (changed && options.skipPersist !== true) {
    persistBoardBackground(state.boardBackground);
  }

  if (!options.silent && changed) {
    dispatchBoardBackgroundChange(state.boardBackground);
  }

  return cloneBoardBackground(state.boardBackground);
}

function applyBoardBackgroundStyle(background) {
  const whiteboard = state.whiteboard;
  if (!whiteboard) return;

  const detail = cloneBoardBackground(background);
  const isImageMode = detail.mode === "image" && detail.image && detail.image.src;

  if (isImageMode) {
    const image = detail.image;
    const fallbackColor = image.backgroundColor || detail.color || defaultBoardBackground.color;
    whiteboard.style.backgroundColor = fallbackColor;
    whiteboard.style.backgroundImage = `url("${image.src}")`;
    whiteboard.style.backgroundSize = image.size || "cover";
    whiteboard.style.backgroundPosition = image.position || "center center";
    whiteboard.style.backgroundRepeat = image.repeat || "no-repeat";
    whiteboard.style.backgroundAttachment = image.attachment || "";
  } else {
    whiteboard.style.backgroundColor = detail.color || defaultBoardBackground.color;
    whiteboard.style.backgroundImage = "none";
    whiteboard.style.backgroundSize = "";
    whiteboard.style.backgroundPosition = "";
    whiteboard.style.backgroundRepeat = "";
    whiteboard.style.backgroundAttachment = "";
  }

  whiteboard.dataset.backgroundMode = isImageMode ? "image" : "color";
  whiteboard.dataset.backgroundKind = isImageMode ? detail.image?.kind || "" : "";
}

function addBoardBackgroundListener(callback, options = {}) {
  if (typeof callback !== "function") {
    return () => {};
  }

  const whiteboard = state.whiteboard;
  if (!whiteboard) {
    return () => {};
  }

  const handler = (event) => {
    callback(cloneBoardBackground(event.detail));
  };

  whiteboard.addEventListener("background:change", handler);

  if (options.immediate) {
    callback(getBoardBackground());
  }

  return () => {
    whiteboard.removeEventListener("background:change", handler);
  };
}

function dispatchBoardBackgroundChange(detail) {
  const whiteboard = state.whiteboard;
  if (!whiteboard) return;
  const payload = cloneBoardBackground(detail);
  const event = new CustomEvent("background:change", { detail: payload });
  whiteboard.dispatchEvent(event);
}

function persistBoardBackground(detail) {
  const storage = getBoardStorage();
  if (!storage) return;
  try {
    const payload = cloneBoardBackground(detail);
    storage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Whiteboard: unable to persist background", error);
  }
}

function readPersistedBoardBackground() {
  const storage = getBoardStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(BACKGROUND_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const normalized = {
      mode: parsed.mode === "image" ? "image" : "color",
      color:
        typeof parsed.color === "string"
          ? parsed.color.trim().toUpperCase()
          : defaultBoardBackground.color,
      image:
        parsed.mode === "image" && parsed.image
          ? normalizeBackgroundImage(parsed.image)
          : null,
    };
    if (normalized.mode === "image" && !normalized.image) {
      normalized.mode = "color";
    }
    return normalized;
  } catch (_error) {
    return null;
  }
}

function getBoardStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage || null;
  } catch (_error) {
    return null;
  }
}

const selectionManager = (() => {
  function setup(pluginArea) {
    if (!pluginArea) return;

    const selectionBox = document.createElement("div");
    selectionBox.className = "selection-box hidden";
    pluginArea.appendChild(selectionBox);

    state.selection = {
      box: selectionBox,
      active: false,
      startX: 0,
      startY: 0,
      pointerId: null,
      currentRect: null,
    };

    pluginArea.addEventListener("pointerdown", (event) => {
      if (state.annotatorMode?.active) return;
      if (event.button !== 0) return;
      if (event.target.closest(".plugin-window")) return;
      if (!state.selection || state.selection.active) return;

      event.preventDefault();
      clear();
      setActiveWindow(null);

      const areaRect = pluginArea.getBoundingClientRect();
      const selection = state.selection;
      selection.startX = event.clientX - areaRect.left;
      selection.startY = event.clientY - areaRect.top;
      selection.currentRect = {
        left: selection.startX,
        top: selection.startY,
        right: selection.startX,
        bottom: selection.startY,
        width: 0,
        height: 0,
      };
      selection.box.style.left = `${selection.startX}px`;
      selection.box.style.top = `${selection.startY}px`;
      selection.box.style.width = "0px";
      selection.box.style.height = "0px";
      selection.box.classList.remove("hidden");
      selection.active = true;
      selection.pointerId = event.pointerId ?? null;

      if (
        pluginArea.setPointerCapture &&
        selection.pointerId !== null &&
        selection.pointerId !== undefined
      ) {
        try {
          pluginArea.setPointerCapture(selection.pointerId);
        } catch (_error) {
          /* ignore inability to capture pointer */
        }
      }

      const handleMove = (moveEvent) => {
        if (!state.selection?.active) return;
        updateRect(moveEvent, pluginArea);
        updateMatches(pluginArea);
      };

      const handleUp = (upEvent) => {
        if (
          pluginArea.releasePointerCapture &&
          state.selection?.pointerId !== null &&
          state.selection?.pointerId !== undefined
        ) {
          try {
            pluginArea.releasePointerCapture(state.selection.pointerId);
          } catch (_error) {
            /* ignore inability to release pointer */
          }
        }
        updateRect(upEvent, pluginArea);
        updateMatches(pluginArea, true);

        if (state.selection) {
          state.selection.active = false;
          state.selection.pointerId = null;
          state.selection.currentRect = null;
          state.selection.box.classList.add("hidden");
          state.selection.box.style.width = "0px";
          state.selection.box.style.height = "0px";
        }

        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    });
  }

  function updateRect(event, pluginArea) {
    const selection = state.selection;
    if (!selection) return;
    const areaRect = pluginArea.getBoundingClientRect();
    const currentX = clamp(event.clientX - areaRect.left, 0, areaRect.width);
    const currentY = clamp(event.clientY - areaRect.top, 0, areaRect.height);

    const startX = selection.startX;
    const startY = selection.startY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    selection.box.style.left = `${left}px`;
    selection.box.style.top = `${top}px`;
    selection.box.style.width = `${width}px`;
    selection.box.style.height = `${height}px`;

    selection.currentRect = {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    };
  }

  function updateMatches(pluginArea, forceFinalize = false) {
    const selection = state.selection;
    if (!selection || !selection.currentRect || !pluginArea) {
      if (forceFinalize) clear();
      return;
    }

    const { width, height } = selection.currentRect;
    const hasMeaningfulArea = width >= 4 && height >= 4;

    if (!hasMeaningfulArea) {
      if (forceFinalize) {
        clear();
      }
      return;
    }

    const areaRect = pluginArea.getBoundingClientRect();
    const windows = pluginArea.querySelectorAll(".plugin-window");
    const matches = new Set();

    windows.forEach((windowEl) => {
      const winRect = windowEl.getBoundingClientRect();
      const relativeRect = {
        left: winRect.left - areaRect.left,
        top: winRect.top - areaRect.top,
        right: winRect.right - areaRect.left,
        bottom: winRect.bottom - areaRect.top,
      };
      relativeRect.width = relativeRect.right - relativeRect.left;
      relativeRect.height = relativeRect.bottom - relativeRect.top;

      if (rectanglesOverlap(selection.currentRect, relativeRect)) {
        matches.add(windowEl);
      }
    });

    applySelectionSet(matches);
  }

  function applySelectionSet(newSelection) {
    if (!state.selectedWindows) {
      state.selectedWindows = new Set();
    }

    state.selectedWindows.forEach((windowEl) => {
      if (!newSelection.has(windowEl)) {
        windowEl.classList.remove("selected");
      }
    });

    newSelection.forEach((windowEl) => {
      if (!state.selectedWindows.has(windowEl)) {
        windowEl.classList.add("selected");
      }
    });

    state.selectedWindows = newSelection;
  }

  function clear() {
    if (state.selectedWindows && state.selectedWindows.size) {
      state.selectedWindows.forEach((windowEl) => {
        windowEl.classList.remove("selected");
      });
    }
    state.selectedWindows = new Set();
    if (state.selection && state.selection.box) {
      state.selection.active = false;
      state.selection.currentRect = null;
      state.selection.box.classList.add("hidden");
      state.selection.box.style.width = "0px";
      state.selection.box.style.height = "0px";
    }
  }

  function deleteSelected() {
    if (!state.selectedWindows || state.selectedWindows.size === 0) return;
    const targets = Array.from(state.selectedWindows);
    clear();
    targets.forEach((windowEl) => closePlugin(windowEl));
  }

  function bringToFront() {
    if (!state.selectedWindows || state.selectedWindows.size === 0) return;
    state.selectedWindows.forEach((windowEl) => bringToFront(windowEl));
  }

  function rectanglesOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  return {
    setup,
    clear,
    deleteSelected,
    bringToFront,
  };
})();

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isEditableTarget(target) {
  if (!target) return false;
  if (target.closest && target.closest(".notepad-editor")) return true;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (!tag) return false;
  return tag === "INPUT" || tag === "TEXTAREA";
}

export { initializePluginScale, updatePluginScale, setActiveWindow };

document.addEventListener("DOMContentLoaded", init);
