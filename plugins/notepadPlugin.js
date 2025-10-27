const defaultConfig = {
  fontColor: "#111827",
  highlightColor: "#fef08a",
  textScale: "1.00",
};

export function createNotepadPlugin() {
  return {
    id: "notepad",
    name: "Quick Notes",
    icon: "fa-solid fa-note-sticky",
    hotkey: "n",
    description: "Rich text notes with quick formatting shortcuts.",
    preferredSize: { width: 320, height: 240 },
    createContent(container) {
      const wrapper = document.createElement("div");
      wrapper.className = "notepad-plugin";
      wrapper.innerHTML = `
        <div
          class="notepad-editor"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          aria-label="Quick notes editor"
          data-placeholder="Write something..."
        ></div>
      `;
      container.appendChild(wrapper);

      const editor = wrapper.querySelector(".notepad-editor");
      const windowEl = container.closest(".plugin-window");
      if (!windowEl || !editor) return;

      const existingState = windowEl._notepadState;
      const config = existingState?.config
        ? { ...defaultConfig, ...existingState.config }
        : { ...defaultConfig };

      const state = {
        editor,
        config,
        ensurePlaceholder: () => ensurePlaceholder(editor),
      };

      windowEl._notepadState = state;

      applyAppearance(windowEl);
      state.ensurePlaceholder();

      const handleKeydown = (event) => {
        if (
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          event.key === " " &&
          maybeConvertListPrefix(editor)
        ) {
          event.preventDefault();
          return;
        }

        const modifier = event.metaKey || event.ctrlKey;
        if (!modifier) return;
        const key = event.key.toLowerCase();
        const code = event.code;

        if (key === "b") {
          event.preventDefault();
          document.execCommand("bold");
          return;
        }

        if (key === "i") {
          event.preventDefault();
          document.execCommand("italic");
          return;
        }

        if (key === "u") {
          event.preventDefault();
          document.execCommand("underline");
          return;
        }

        if (event.shiftKey && (code === "Digit8" || key === "*")) {
          event.preventDefault();
          document.execCommand("insertUnorderedList");
          return;
        }

        if (event.shiftKey && (code === "Digit7" || key === "&")) {
          event.preventDefault();
          document.execCommand("insertOrderedList");
          return;
        }

        if (event.shiftKey && (key === "h" || code === "KeyH")) {
          event.preventDefault();
          applyHighlight(windowEl);
        }
      };

      const handlePaste = (event) => {
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!text) return;
        document.execCommand("insertText", false, text);
      };

      const handleInput = () => {
        state.ensurePlaceholder();
      };

      editor.addEventListener("keydown", handleKeydown);
      editor.addEventListener("paste", handlePaste);
      editor.addEventListener("input", handleInput);
      editor.addEventListener("focus", () => editor.classList.add("focused"));
      editor.addEventListener("blur", () => {
        editor.classList.remove("focused");
        state.ensurePlaceholder();
      });

      windowEl.addEventListener(
        "plugin:destroy",
        () => {
          editor.removeEventListener("keydown", handleKeydown);
          editor.removeEventListener("paste", handlePaste);
          editor.removeEventListener("input", handleInput);
        },
        { once: true }
      );
    },
    createSettings({ windowEl, container }) {
      const state = windowEl?._notepadState;
      if (!state) return null;

      container.innerHTML = "";

      const heading = document.createElement("p");
      heading.className = "settings-heading";
      heading.textContent = "Quick Notes";

      const fontRow = document.createElement("label");
      fontRow.className = "settings-row";
      fontRow.innerHTML = `
        <span>Font colour</span>
        <input type="color" aria-label="Font colour" />
      `;

      const highlightRow = document.createElement("label");
      highlightRow.className = "settings-row";
      highlightRow.innerHTML = `
        <span>Highlight</span>
        <input type="color" aria-label="Highlight colour" />
      `;

      const sizeRow = document.createElement("label");
      sizeRow.className = "settings-row";
      sizeRow.innerHTML = `
        <span>Text size</span>
        <select aria-label="Text size">
          <option value="0.9">Small</option>
          <option value="1">Normal</option>
          <option value="1.2">Large</option>
          <option value="1.4">Extra</option>
        </select>
      `;

      container.append(heading, fontRow, highlightRow, sizeRow);

      const fontInput = fontRow.querySelector("input");
      const highlightInput = highlightRow.querySelector("input");
      const sizeSelect = sizeRow.querySelector("select");

      const handleFontChange = (event) => {
        state.config.fontColor = event.target.value || defaultConfig.fontColor;
        applyAppearance(windowEl);
      };

      const handleHighlightChange = (event) => {
        state.config.highlightColor =
          event.target.value || defaultConfig.highlightColor;
        applyAppearance(windowEl);
      };

      const handleSizeChange = (event) => {
        const value = parseFloat(event.target.value);
        if (!Number.isNaN(value)) {
          state.config.textScale = value.toFixed(2);
          applyAppearance(windowEl);
        }
      };

      fontInput.addEventListener("input", handleFontChange);
      highlightInput.addEventListener("input", handleHighlightChange);
      sizeSelect.addEventListener("change", handleSizeChange);

      const sync = () => {
        fontInput.value = state.config.fontColor;
        highlightInput.value = state.config.highlightColor;
        sizeSelect.value = String(parseFloat(state.config.textScale));
      };

      sync();

      return {
        sync,
        teardown() {
          fontInput.removeEventListener("input", handleFontChange);
          highlightInput.removeEventListener("input", handleHighlightChange);
          sizeSelect.removeEventListener("change", handleSizeChange);
        },
      };
    },
  };
}

function applyAppearance(windowEl) {
  if (!windowEl || !windowEl._notepadState) return;
  const state = windowEl._notepadState;
  const editor = state.editor;
  if (!editor) return;

  const fontColor = state.config.fontColor || defaultConfig.fontColor;
  const highlightColor =
    state.config.highlightColor || defaultConfig.highlightColor;
  const scaleValue =
    parseFloat(state.config.textScale) || parseFloat(defaultConfig.textScale);

  editor.style.setProperty("--notepad-font-color", fontColor);
  editor.style.setProperty("--notepad-highlight-color", highlightColor);
  editor.style.setProperty("--notepad-font-scale", scaleValue.toFixed(2));

  windowEl.dataset.textColor = fontColor;
  windowEl.dataset.highlightColor = highlightColor;
  windowEl.dataset.textScale = scaleValue.toFixed(2);
}

function ensurePlaceholder(editor) {
  if (!editor) return;
  const isEmpty =
    editor.textContent.trim().length === 0 && editor.childNodes.length <= 1;
  if (isEmpty) {
    editor.classList.add("notepad-empty");
    if (!editor.innerHTML.trim()) {
      editor.innerHTML = "<br />";
    }
  } else {
    editor.classList.remove("notepad-empty");
  }
}

function maybeConvertListPrefix(editor) {
  if (!editor) return false;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return false;
  }

  const anchorNode = selection.anchorNode;
  if (!editor.contains(anchorNode) || anchorNode.nodeType !== Node.TEXT_NODE) {
    return false;
  }

  const offset = selection.anchorOffset;
  if (offset !== anchorNode.textContent.length) return false;

  const contentBefore = anchorNode.textContent.slice(0, offset);
  const trimmed = contentBefore.trim();
  if (!trimmed || contentBefore !== trimmed) return false;

  if (
    anchorNode.previousSibling &&
    anchorNode.previousSibling.textContent.trim().length
  ) {
    return false;
  }

  const parent = anchorNode.parentElement;
  if (parent && parent.closest("ul,ol")) return false;

  let command = null;
  if (trimmed === "-" || trimmed === "*" || trimmed === "•") {
    command = "insertUnorderedList";
  } else if (/^\d+\.$/.test(trimmed)) {
    command = "insertOrderedList";
  }

  if (!command) return false;

  anchorNode.textContent = anchorNode.textContent.slice(contentBefore.length);
  document.execCommand(command);
  ensurePlaceholder(editor);
  return true;
}

function applyHighlight(windowEl) {
  if (!windowEl || !windowEl._notepadState) return;
  const color =
    windowEl._notepadState.config.highlightColor || defaultConfig.highlightColor;

  const canHilite =
    typeof document.queryCommandSupported === "function" &&
    document.queryCommandSupported("hiliteColor");
  const preferredCommand = canHilite ? "hiliteColor" : "backColor";
  const success = document.execCommand(preferredCommand, false, color);
  if (!success) {
    safeWrapSelection(color);
  }
}

function safeWrapSelection(color) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const wrapper = document.createElement("span");
  wrapper.style.backgroundColor = color;
  wrapper.style.color = "inherit";
  try {
    range.surroundContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch (_error) {
    /* ignore wrapping errors for complex selections */
  }
}
