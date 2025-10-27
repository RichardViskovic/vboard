import assert from "node:assert/strict";

const noop = () => {};

const eventHandlers = {};

globalThis.performance = {
  now: () => 0,
};

globalThis.window = {
  requestAnimationFrame: (cb) => {
    cb(performance.now());
    return 0;
  },
  cancelAnimationFrame: noop,
};

globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = noop;

globalThis.document = {
  addEventListener: (event, handler) => {
    eventHandlers[event] = handler;
  },
  removeEventListener: noop,
  getElementById: () => null,
  querySelectorAll: () => [],
  body: {
    contains: () => false,
  },
};

class ResizeObserverStub {
  constructor() {}
  observe() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub;
globalThis.CustomEvent = class {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
  }
};

const module = await import("../menu.js");
const { initializePluginScale, setActiveWindow } = module;

function createStyleStub() {
  const props = Object.create(null);
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "setProperty") {
          return (name, value) => {
            props[name] = value;
          };
        }
        if (key === "getPropertyValue") {
          return (name) => props[name];
        }
        return props[key];
      },
      set(_target, key, value) {
        props[key] = value;
        return true;
      },
      ownKeys() {
        return Reflect.ownKeys(props);
      },
      getOwnPropertyDescriptor(_target, key) {
        if (key in props) {
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: props[key],
          };
        }
        return undefined;
      },
    }
  );
}

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(value) {
      set.add(value);
    },
    remove(value) {
      set.delete(value);
    },
    contains(value) {
      return set.has(value);
    },
  };
}

function createWindowFixture({
  baseWidth = 320,
  baseHeight = 180,
  headerHeight = 52,
  inactiveJitter = 4,
} = {}) {
  const windowEl = {
    dataset: {},
    style: createStyleStub(),
    classList: createClassList(),
    isConnected: true,
    parentElement: {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 1024,
        height: 768,
      }),
    },
    querySelector(selector) {
      if (selector === ".plugin-body") {
        return pluginBody;
      }
      if (selector === ".plugin-header") {
        return header;
      }
      return null;
    },
    addEventListener: noop,
    removeEventListener: noop,
  };

  const header = {
    get offsetHeight() {
      return windowEl.classList.contains("active") ? headerHeight : 0;
    },
  };

  const pluginBody = {
    get offsetWidth() {
      return baseWidth;
    },
    get offsetHeight() {
      return windowEl.classList.contains("active")
        ? baseHeight
        : baseHeight + inactiveJitter;
    },
  };

  return windowEl;
}

function createAnnotationFixture({
  baseWidth = 240,
  baseHeight = 180,
  headerHeight = 52,
  shrinkWidth = 18,
  shrinkHeight = 24,
} = {}) {
  const windowEl = {
    dataset: {
      baseWidth: String(baseWidth),
      baseHeight: String(baseHeight),
    },
    style: createStyleStub(),
    classList: createClassList(["annotation-shape-window"]),
    isConnected: true,
    get offsetWidth() {
      return baseWidth;
    },
    get offsetHeight() {
      return baseHeight;
    },
    parentElement: {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 1024,
        height: 768,
      }),
    },
    querySelector(selector) {
      if (selector === ".plugin-body") {
        return pluginBody;
      }
      if (selector === ".plugin-header") {
        return header;
      }
      return null;
    },
    addEventListener: noop,
    removeEventListener: noop,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: baseWidth,
      height: baseHeight,
    }),
  };

  const header = {
    get offsetHeight() {
      return windowEl.classList.contains("active") ? headerHeight : 0;
    },
  };

  const pluginBody = {
    get offsetWidth() {
      return windowEl.classList.contains("active")
        ? baseWidth
        : baseWidth - shrinkWidth;
    },
    get offsetHeight() {
      return windowEl.classList.contains("active")
        ? baseHeight
        : baseHeight - shrinkHeight;
    },
  };

  return windowEl;
}

function parsePx(value) {
  if (!value) return NaN;
  const match = /(-?\d+(\.\d+)?)/.exec(String(value));
  return match ? Number(match[1]) : NaN;
}

const windowFixture = createWindowFixture();
document.body.contains = (node) => node === windowFixture;

setActiveWindow(windowFixture);
await Promise.resolve();

initializePluginScale(windowFixture);
await Promise.resolve();

const activeHeight = parsePx(
  windowFixture.style.getPropertyValue("--plugin-height")
);
assert(Math.abs(activeHeight - 180) < 0.001, "active height should match base");

setActiveWindow(null);
await Promise.resolve();

const inactiveHeight = parsePx(
  windowFixture.style.getPropertyValue("--plugin-height")
);
assert(
  Math.abs(inactiveHeight - activeHeight) < 0.001,
  "inactive height should remain unchanged"
);

console.log("plugin scale focus toggle ✅");

const annotationFixture = createAnnotationFixture();
document.body.contains = (node) => node === windowFixture || node === annotationFixture;

setActiveWindow(annotationFixture);
await Promise.resolve();

initializePluginScale(annotationFixture);
await Promise.resolve();

const annotationActiveWidth = parsePx(
  annotationFixture.style.getPropertyValue("--plugin-width")
);
assert(
  Math.abs(annotationActiveWidth - 240) < 0.001,
  "annotation active width should match base"
);

const annotationActiveHeight = parsePx(
  annotationFixture.style.getPropertyValue("--plugin-height")
);
assert(
  Math.abs(annotationActiveHeight - 180) < 0.001,
  "annotation active height should match base"
);

setActiveWindow(null);
await Promise.resolve();

const annotationInactiveWidth = parsePx(
  annotationFixture.style.getPropertyValue("--plugin-width")
);
assert(
  Math.abs(annotationInactiveWidth - annotationActiveWidth) < 0.001,
  "annotation width should stay stable when inactive"
);

const annotationInactiveHeight = parsePx(
  annotationFixture.style.getPropertyValue("--plugin-height")
);
assert(
  Math.abs(annotationInactiveHeight - annotationActiveHeight) < 0.001,
  "annotation height should stay stable when inactive"
);

console.log("annotation width focus toggle ✅");
console.log("annotation height focus toggle ✅");
