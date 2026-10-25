# pi-dragon-tui

**English** | [简体中文](README.zh-CN.md)

Dragon Ball / Namek-flavored pi extension: rounded (or flat) editor frame, framed modals, Namekian spinner, a tok/s stat, and markdown output tinted to match.

![editor frame, Namekian spinner and tok/s](assets/overview.png)

## Install

```bash
pi install npm:pi-dragon-tui
# or
pi install git:github.com/oahcz-7891/pi-dragon-tui
```

Restart pi. Later edits: `/reload`.

## Features

- **Editor box** — `rounded` frame (default) or `lines` (top/bottom rules only, pi's native look), plus a border-colored prompt glyph (`>` by default; the menu's Prompt glyph switches to `_` or hides it); wrapped lines keep the indent. Border color ignores theme / thinking-level / bash-mode overrides.
- **Modals** — every `ctx.ui.custom()` dialog gets the same frame (rounded or lines), with pi's own full-width rules and key-hint footers stripped (keep them via `stripInnerRules: false` in `ROUNDED_CONFIG`; `lines` style always strips them). Built-in `select` / `confirm` / `input` / `editor` bypass `custom()` and stay unframed.
- **Working words** — "Working" rotates through Namekian words (`Purunga…`).
- **Collapsed thinking** — with thinking hidden (`ctrl+T`), pick how much live reasoning shows under pi's `Thinking...` header: `1 line`, `2 lines`, or `hidden`. Rows follow pi's thinking style, are tail-truncated so the newest words stay visible, and end with a dim `… (ctrl+t 展开)` hint. Expanded thinking is untouched.
- **TPS** — `48.2 tok/s` on the status line, in the border color. Live per-message speed while streaming, then the session average (output tokens ÷ pure generation time; tool waits and TTFT excluded). Pinned to the session; the native status line is untouched.
- **Output tint** — assistant markdown follows the border color: hues snap to it, each token keeps its own lightness plus a role offset (headings brightest, code fences darkest; reversed on light themes), saturation = theme color × weight. Body text gets a faint 12% sRGB wash. Code-block syntax highlighting, tool output, and thinking stay native. Toggle it in the menu; retinted on startup, `/reload`, and when the color changes.
- **`/dragon`** — settings menu for border color, output tint, frame style, collapsed thinking, and the prompt glyph: `↑↓` to move, `Space` to change in place, `Esc` to close.

## Commands

```
/dragon                # settings menu (only command)
```

![the /dragon settings menu](assets/dragon-menu.png)

The old `/dragon <suffix>` subcommands (`goku`, `frame`, `thinking`, `prompt`, …) are gone: any argument is ignored and the menu opens instead. Choices are saved to `<agent dir>/.dragon-tui.json` (`~/.pi/agent/`, overridable via `$PI_CODING_AGENT_DIR` or `$PI_DRAGON_TUI_CONFIG`) and survive restarts. Every color consumer reads one mutable source, so switching applies on the next frame — no `/reload`, and draft text is kept.

## Config

Constants at the top of `index.ts`:

- **Prompt / frame** — `BORDER_HEX` (border color), `PROMPT_LEAD` / `PROMPT_GLYPH_DEFAULT` (space and glyph before the input line; default `">"`, also `"_"` / `"none"`), `FRAME_STYLE_DEFAULT` (`"rounded"` / `"line"`), `ROUNDED_ENABLED`.
- **Output tint** — `OUTPUT_TINT_DEFAULT` (`true`; the menu's Output tint row overrides and saves). Tint weights and lightness offsets live in `MD_TINT` at the top of `tint.ts`; `BODY_MIX` is the body wash (0.12, sRGB).
- **TPS** — `TPS_ENABLED`, `TPS_PREFIX` / `TPS_SUFFIX` (` tok/s`), `TPS_REFRESH_MS`.
- **Thinking / spinner** — `THINKING_MODE_DEFAULT` (`"line2"`), `THINKING_HINT` (suffix after the block; `""` hides it), `WORKING_WORDS`, `WORKING_ROTATE_MS`.
