# pi-dragon-tui

[English](README.md) | **简体中文**

龙珠 / 那美克星风格的 pi 扩展：圆角（或纯横线）编辑器边框、带框弹窗、那美克星语加载词、tok/s 速度显示，以及跟随边框色的输出染色。

![编辑器边框、那美克星语加载词与 tok/s](assets/overview.png)

## 安装

```bash
pi install npm:pi-dragon-tui
# 或者
pi install git:github.com/oahcz-7891/pi-dragon-tui
```

重启 pi。之后修改代码用 `/reload` 即可。

## 功能

- **编辑器外框** — `rounded` 圆角边框（默认）或 `lines` 纯横线（只留上下两条线，pi 原生观感），加边框色的提示符（默认 `>`，菜单里可切成 `_` 或关掉）；自动换行的行会保持对齐缩进。边框颜色不受主题 / 思考等级 / bash 模式的影响。
- **弹窗** — 所有 `ctx.ui.custom()` 弹窗都套上同样的边框（圆角或纯横线），并去掉 pi 自带的全宽分隔线与按键提示底栏（想让它们保留，把 `ROUNDED_CONFIG` 里的 `stripInnerRules` 设为 `false`；`lines` 样式下始终去掉）。内置的 `select` / `confirm` / `input` / `editor` 不走 `custom()`，因此不会加框。
- **加载词** — "Working" 会轮换为那美克星语词汇（`Purunga…`）。
- **折叠的思考** — 在思考隐藏（`ctrl+T`）时，可以选择在 pi 的 `Thinking...` 标题下显示多少实时推理内容：`1 line`、`2 lines` 或 `hidden`。各行沿用 pi 的思考样式，并从尾部截断以保留最新内容，块结束后显示暗色的 `… (ctrl+t 展开)` 提示。展开状态下的思考不受影响。
- **TPS** — 状态栏显示 `48.2 tok/s`，颜色与边框一致。流式输出时显示当前消息的实时速度，生成结束后切换为会话平均值（输出 token ÷ 纯生成时间，已排除工具等待与首 token 延迟）。数值固定在当前会话中；pi 原生状态栏不受影响。
- **输出染色** — 助理消息的 markdown 跟着边框色走：色相全部旋到主题色；每个 token 保留自己的亮度再加角色偏移（标题最亮、代码块围栏最暗；亮色主题方向相反），饱和度 = 主题色饱和度 × 权重。正文额外混入 12% 主题色（sRGB）。代码块语法高亮、工具输出与思考不染色。菜单里可开关，启动 / `/reload` / 换色时重新接上。
- **`/dragon`** — 设置菜单，可调边框颜色、输出染色、边框样式、折叠思考显示与输入框提示符：`↑↓` 移动，`Space` 就地切换，`Esc` 关闭。

## 命令

```
/dragon                # 设置菜单（唯一命令）
```

![`/dragon` 设置菜单](assets/dragon-menu.png)

旧的 `/dragon <后缀>` 子命令（`goku`、`frame`、`thinking`、`prompt` …）已全部取消：带任何参数都只打开菜单。选择会保存到 `<agent 目录>/.dragon-tui.json`（默认 `~/.pi/agent/`，可用 `$PI_CODING_AGENT_DIR` 或 `$PI_DRAGON_TUI_CONFIG` 覆盖），重启后依然生效。所有使用颜色的地方都读取同一个可变数据源，因此切换会在下一帧立即生效 —— 无需 `/reload`，输入框里已输入的文字也不会丢失。

## 配置

`index.ts` 顶部的常量：

- **提示符 / 边框** — `BORDER_HEX`（边框颜色），`PROMPT_LEAD` / `PROMPT_GLYPH_DEFAULT`（输入行前的空格与符号；默认 `">"`，还可选 `"_"` / `"none"`），`FRAME_STYLE_DEFAULT`（`"rounded"` / `"line"`），`ROUNDED_ENABLED`。
- **输出染色** — `OUTPUT_TINT_DEFAULT`（`true`；菜单里的 Output tint 会覆盖并写进配置）。权重与亮度偏移在 `tint.ts` 顶部的 `MD_TINT` 里；正文混色比例是 `BODY_MIX`（0.12，sRGB）。
- **TPS** — `TPS_ENABLED`，`TPS_PREFIX` / `TPS_SUFFIX`（` tok/s`），`TPS_REFRESH_MS`。
- **思考 / 加载词** — `THINKING_MODE_DEFAULT`（`"line2"`），`THINKING_HINT`（块后后缀；`""` 隐藏），`WORKING_WORDS`，`WORKING_ROTATE_MS`。
