# AGENTS.md

## Project Pulse
- Single-page whiteboard (`index.html`) spawns draggable/resizable plugin windows from a FontAwesome taskbar (`menu.js`).
- Core plugins now live in dedicated modules: `plugins/timerPlugin.js`, `plugins/notepadPlugin.js`, and a board-wide Annotate mode in `menu.js`.
- Timer delivers full inline-edit countdown UX with icon controls; Quick Notes provides rich text editing with formatting hotkeys and colour/size settings.
- Background Manager now surfaces as a left-side overlay panel (no floating window) with colour picker, wallpaper presets, and custom uploads via `plugins/backgroundPlugin.js` + `wallpapers/manifest.json`.
- Board background selections persist via `localStorage`, restoring on load before emitting `background:change`.
- Annotation mode overlays a toolbar + SVG surface, creating framed annotation windows that integrate with standard window interactions.
- Window chrome fades on blur while keeping layout stable; per-window colour settings remain via the popover.

## Current Implementation Highlights
- `menu.js`
  - `pluginDefinitions` imports timer/notepad factories and builds the annotate definition locally.
  - Board background helpers (`getBoardBackground`/`setBoardBackground`) manage styling, persistence, and broadcast `background:change` events.
  - `selectionManager` encapsulates marquee selection, multi-select state, raising, and bulk delete.
  - Window interactions (drag, edge resize, focus, background colour) consolidated; plugin scaling guarded against focus jitter.
  - Annotator mode handles overlay lifecycle, drawing tools, and converts strokes into annotation windows whose dimensions persist through focus changes.
- `plugins/timerPlugin.js`
  - Encapsulates DOM creation, countdown state machine, manual time entry buffer, and button state updates.
  - Emits `plugin:destroy` cleanup to stop RAF loops.
- `plugins/notepadPlugin.js`
  - Sets up editable area with placeholder management, formatting shortcuts (bold/italic/underline, lists, highlight), and settings UI for colours/scale.
- `plugins/backgroundPlugin.js`
  - Renders the toggleable left-side panel, wiring colour picker, wallpapers, uploads, and close/escape handling without spawning windows.
  - Uses board background helpers to stay in sync across sessions and broadcast updates to listeners.
- `styles.css`
  - Utilizes CSS custom props (`--plugin-scale`, `--plugin-width`, `--plugin-height`) for responsive layouts.
  - Timer display spacing tuned to avoid overlap; toolbar/overlay styling supports annotation mode.
  - Background Manager styles cover the left-side panel shell, colour picker layout, wallpaper grid, and upload preview affordances.

## TODO / Open Questions
- Annotation select tool stub (`menu.js:860-940`) still needs implementation to reopen shapes directly from the overlay.
- Persist annotation toolbar position between sessions (`menu.js:905`, `styles.css:564`).
- Consider stroke width scaling that respects board zoom (`menu.js:1100`).
- Evaluate performance impact of per-window ResizeObservers if large plugin counts become common.
- Persistence layer (e.g., `localStorage`) remains unimplemented for notes/timer content.

## Testing Notes
- Regression suite: `node tests/pluginScale.test.mjs` verifies plugin and annotation scaling stability across focus changes.
- Manual QA: browser-based resizing (extreme aspect ratios), annotation drawing/teardown, multi-select drag/delete, keyboard shortcuts while editing text, plus background manager overlay flows (toggle visibility, colour swap, preset wallpaper, upload/remove, persistence across reload).

## Next Steps (Suggested)
1. Finish annotation select tool and toolbar persistence; add automated tests for pointer flows once harness exists.
2. Modularize annotator logic into its own plugin file for parity with timer/notes and ease of maintenance.
3. Introduce persistence for timer durations, note content, and annotation toolbar position.
4. Expand automated coverage (selection manager edge cases, annotator tool switching) to reduce regression risk.
