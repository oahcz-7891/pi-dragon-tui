# pi-dragon-tui

[English](README.md) | **简体中文**

龙珠 / 那美克星风格的 pi 扩展：带框编辑器与弹窗、跟随配色的 markdown 输出、那美克星语加载词、tok/s，以及可切换的强调色。

![编辑器边框、那美克星语加载词与 tok/s](assets/overview.png)

## 安装

```bash
pi install npm:pi-dragon-tui
# 或者
pi install git:github.com/oahcz-7891/pi-dragon-tui
```

## 功能

- **编辑器外框** — `rounded` 圆角框或 `lines` 纯横线（pi 原生观感），带边框色提示符（`>` / `_` / 隐藏）；换行保持缩进。边框色不受主题、思考等级、bash 模式影响。
- **弹窗外框** — 所有 `ctx.ui.custom()` 弹窗自动套同款边框；内置 `select` / `confirm` / `input` / `editor` 保持原生。
- **输出染色** — 助理消息的 markdown（标题、链接、行内代码、代码块、引用、列表符号）和正文会跟着当前配色走；代码块内的语法高亮保持 pi 原生。`/dragon` 菜单里的 Output tint 可开关，默认关。
- **配色** — 悟空金 `#f0c674` / 贝吉塔蓝 `#7d9ed4` / 比克绿 `#7fc95a`。`/dragon` 里实时切换；边框、spinner、TPS、提示符、输出染色共用同一个色源，选择保存后重启仍生效。
- **折叠思考** — 思考隐藏时，在 pi 的 `Thinking...` 下显示 `1 line` / `2 lines` / 不显示；展开状态不动。
- **那美克星语加载词** — "Working" 轮换 `Purunga…` 等词，可按轮或定时切换。
- **TPS** — 流式时显示实时 `48.2 tok/s`，结束后显示会话平均，颜色与边框一致；不计工具等待和首 token 延迟。

## 命令

```
/dragon    # 设置菜单：边框配色、输出染色、边框样式、折叠思考、输入框提示符
```

`↑↓` 移动，`Space` / `Enter` 就地切换，`Esc` 关闭。没有子命令 —— 带任何参数也只会打开菜单。

选择保存在 `<agent 目录>/.dragon-tui.json`（默认 `~/.pi/agent/`，可用 `$PI_CODING_AGENT_DIR` 或 `$PI_DRAGON_TUI_CONFIG` 覆盖），重启后生效。

![`/dragon` 设置菜单](assets/dragon-menu.png)

## 配置

`index.ts` 顶部的常量：

- **提示符** — `BORDER_HEX`、`PROMPT_LEAD`、`PROMPT_GLYPH_DEFAULT`、`FRAME_STYLE_DEFAULT`、`ROUNDED_ENABLED`。
- **输出染色** — `OUTPUT_TINT_DEFAULT`；权重与正文混色在 `tint.ts`。
- **TPS** — `TPS_ENABLED`、`TPS_PREFIX`、`TPS_SUFFIX`、`TPS_REFRESH_MS`。
- **思考 / 加载词** — `THINKING_MODE_DEFAULT`、`THINKING_HINT`、`WORKING_WORDS`、`WORKING_ROTATE_MS`。
