const DEFAULT_MINUTES = 10;
const DEFAULT_DURATION_MS = DEFAULT_MINUTES * 60 * 1000;

export function createTimerPlugin({ setActiveWindow }) {
  return {
    id: "timer",
    name: "Timer",
    icon: "fa-solid fa-stopwatch",
    hotkey: "t",
    description: "Prototype timer widget with placeholder controls.",
    preferredSize: { width: 240, height: 180 },
    createContent(container) {
      const elements = buildTimerDom();
      container.appendChild(elements.wrapper);

      const state = createTimerState();
      wireTimerControls({ elements, state, setActiveWindow });
      updateDisplayFromState(elements, state);
      updateButtonState(elements, state);

      const pluginWindow = container.closest(".plugin-window");
      if (pluginWindow) {
        pluginWindow.addEventListener(
          "plugin:destroy",
          () => {
            stopTimer({ state, elements, options: { force: true } });
          },
          { once: true }
        );
      }
    },
  };
}

function buildTimerDom() {
  const wrapper = document.createElement("div");
  wrapper.className = "timer-plugin";
  wrapper.innerHTML = `
    <div class="timer-display" data-editing="false" role="timer" aria-live="polite" tabindex="0">
      <span class="timer-minutes">10</span>
      <span class="timer-separator">:</span>
      <span class="timer-seconds">00</span>
    </div>
    <div class="timer-ui">
      <div class="timer-controls">
        <button type="button" class="timer-button timer-toggle" aria-label="Start timer">
          <i class="fa-solid fa-play"></i>
        </button>
        <button type="button" class="timer-button timer-reset" aria-label="Reset timer">
          <i class="fa-solid fa-stop"></i>
        </button>
      </div>
    </div>
  `;

  return {
    wrapper,
    display: wrapper.querySelector(".timer-display"),
    minutesSpan: wrapper.querySelector(".timer-minutes"),
    secondsSpan: wrapper.querySelector(".timer-seconds"),
    toggleBtn: wrapper.querySelector(".timer-toggle"),
    resetBtn: wrapper.querySelector(".timer-reset"),
  };
}

function createTimerState() {
  return {
    baseMs: DEFAULT_DURATION_MS,
    remainingMs: DEFAULT_DURATION_MS,
    running: false,
    rafId: null,
    lastTick: null,
    manualEntry: null,
  };
}

function wireTimerControls({ elements, state, setActiveWindow }) {
  const { display, toggleBtn, resetBtn } = elements;

  const tick = (now) => {
    if (!state.running) return;
    const elapsed = state.lastTick == null ? 0 : now - state.lastTick;
    state.lastTick = now;
    state.remainingMs = Math.max(0, state.remainingMs - elapsed);
    updateDisplayFromState(elements, state);
    if (state.remainingMs <= 0) {
      stopTimer({ state, elements });
    } else {
      state.rafId = requestAnimationFrame(tick);
    }
  };

  const startTimer = () => {
    if (state.running || state.baseMs <= 0) return;
    if (state.remainingMs <= 0) {
      state.remainingMs = state.baseMs;
    }
    state.running = true;
    state.lastTick = performance.now();
    updateButtonState(elements, state);
    state.rafId = requestAnimationFrame(tick);
  };

  const toggleTimer = () => {
    if (state.running) {
      stopTimer({ state, elements });
    } else {
      startTimer();
    }
  };

  const resetTimer = () => {
    stopTimer({ state, elements, options: { reset: true } });
  };

  const beginEdit = () => {
    if (display.dataset.editing === "true") return;
    stopTimer({ state, elements });
    display.dataset.editing = "true";

    const pluginWindow = display.closest(".plugin-window");
    let typedDigits = "";
    let finalized = false;
    const previousManual = state.manualEntry;

    const cleanup = () => {
      display.removeEventListener("keydown", handleKeydown, true);
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
      display.dataset.editing = "false";
      display.classList.remove("editing");
    };

    const updateFromTyped = () => {
      const padded = typedDigits.padStart(4, "0");
      elements.minutesSpan.textContent = padded.slice(0, 2);
      elements.secondsSpan.textContent = padded.slice(2);
    };

    const finalize = (shouldApply) => {
      if (finalized) return;
      finalized = true;
      cleanup();

      if (shouldApply) {
        const padded = typedDigits.padStart(4, "0");
        const minutes = parseInt(padded.slice(0, 2), 10) || 0;
        const seconds = parseInt(padded.slice(2), 10) || 0;
        const totalMs = (minutes * 60 + seconds) * 1000;
        state.baseMs = totalMs;
        state.remainingMs = totalMs;
        const manualMinutes = padded.slice(0, 2);
        const manualSeconds = padded.slice(2);
        state.manualEntry = {
          minutes,
          seconds,
          displayMinutes: manualMinutes,
          displaySeconds: manualSeconds,
          initialTotal: minutes * 60 + seconds,
          threshold: minutes * 60 + Math.min(seconds, 59),
        };
        updateDisplayFromState(elements, state, { forceManualDisplay: true });
        updateButtonState(elements, state);
      } else {
        state.manualEntry = previousManual || null;
        updateDisplayFromState(elements, state, { forceManualDisplay: true });
      }

      setActiveWindow(null);
    };

    const commit = () => finalize(true);
    const cancel = () => finalize(false);

    const handleKeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        typedDigits = (typedDigits + event.key).slice(-4);
        updateFromTyped();
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        typedDigits = typedDigits.slice(0, -1);
        updateFromTyped();
      }
    };

    const handleOutsidePointer = (event) => {
      if (pluginWindow && pluginWindow.contains(event.target)) return;
      commit();
    };

    document.addEventListener("pointerdown", handleOutsidePointer, true);
    display.addEventListener("keydown", handleKeydown, true);

    typedDigits = "";
    updateFromTyped();
    display.classList.add("editing");
    display.focus({ preventScroll: true });
  };

  display.addEventListener("click", beginEdit);
  display.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      beginEdit();
    }
  });

  toggleBtn.addEventListener("click", toggleTimer);
  resetBtn.addEventListener("click", resetTimer);
}

function stopTimer({ state, elements, options = {} }) {
  const { reset = false, force = false } = options;
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  state.running = false;
  state.lastTick = null;
  if (reset || force) {
    state.remainingMs = state.baseMs;
  } else {
    state.remainingMs = Math.max(0, state.remainingMs);
  }
  if (elements) {
    updateDisplayFromState(elements, state, { forceManualDisplay: reset || force });
    updateButtonState(elements, state);
  }
}

function updateDisplay(elements, { minutes, seconds }) {
  elements.minutesSpan.textContent = minutes;
  elements.secondsSpan.textContent = seconds;
}

function formatFromMs(ms) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
  };
}

function updateDisplayFromState(elements, state, options = {}) {
  const { forceManualDisplay = false } = options;
  const manual = state.manualEntry;

  if (manual) {
    const showManualAsTyped =
      forceManualDisplay ||
      (!state.running && state.remainingMs === state.baseMs);

    if (showManualAsTyped) {
      updateDisplay(elements, {
        minutes: manual.displayMinutes,
        seconds: manual.displaySeconds,
      });
      return;
    }

    const remainingSeconds = Math.max(0, Math.floor(state.remainingMs / 1000));

    if (manual.seconds > 59 && remainingSeconds > manual.threshold) {
      const diff = manual.initialTotal - remainingSeconds;
      const currentSeconds = Math.max(manual.seconds - diff, 0);
      updateDisplay(elements, {
        minutes: manual.displayMinutes,
        seconds: String(currentSeconds).padStart(2, "0"),
      });
      return;
    }

    if (manual.seconds > 59 && remainingSeconds <= manual.threshold) {
      state.manualEntry = null;
    }
  }

  updateDisplay(elements, formatFromMs(state.remainingMs));
}

function updateButtonState(elements, state) {
  elements.toggleBtn.innerHTML = `<i class="fa-solid ${state.running ? "fa-pause" : "fa-play"}"></i>`;
  elements.toggleBtn.setAttribute(
    "aria-label",
    state.running ? "Pause timer" : "Start timer"
  );
  const shouldDisable = state.baseMs <= 0;
  elements.toggleBtn.disabled = shouldDisable;
  elements.toggleBtn.classList.toggle("timer-button-disabled", shouldDisable);
}
