/**
 * `/dragon` 的选择菜单。
 *
 * 为什么不用 `ctx.ui.select()`：
 * 内置 select 走的是 pi 自己的 ExtensionSelectorComponent
 * （interactive-mode.js 里 `select:` → `showExtensionSelector()`），
 * 根本不经过 `ctx.ui.custom()`，所以 rounded-frame.ts 的圆角包装抓不到它。
 * 换成 `ctx.ui.custom()` 自己搭一个，边框就能被套上，
 * 颜色也跟随 /dragon 的当前配色（RoundedFrame 持有的是 border.paint）。
 *
 * DragonMenu 用 pi-tui 的 SettingsList 搭一个设置页，每一项都能用
 * 空格 / 回车「就地」调节，菜单不关：
 *   - Border color        → 在 goku / vegeta / piccolo 之间循环；
 *   - Output tint         → 输出染色 on / off（markdown 跟着边框色，见 tint.ts）；
 *   - Frame style         → 在 rounded（圆角框）/ lines（只剩上下横线）之间循环；
 *   - Collapsed thinking  → 在 1 line / 2 lines / hidden 之间循环；
 *   - Prompt glyph        → 在 hidden / `>` / `_` 之间循环（输入框行首提示符）。
 * 上下键移动光标，Esc 关闭。
 *
 * 键盘导航复用 pi-tui 的 SettingsList，观感和内置弹框一致。
 * 这里只画内容，不画边框 —— 边框由外层的 RoundedFrame 负责。
 */

import {
	Container,
	SettingsList,
	Spacer,
	Text,
	type Component,
	type Focusable,
	type SettingItem,
} from "@earendil-works/pi-tui";
import { getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	FRAME_STYLES,
	FRAME_STYLE_LABELS,
	PROMPT_GLYPHS,
	PROMPT_GLYPH_LABELS,
	THINKING_MODES,
	THINKING_MODE_LABELS,
	type FrameStyle,
	type PromptGlyph,
	type ThinkingMode,
} from "./palette.ts";

/** 一个配色选项：key 是 `/dragon` 的主参数名，label 是菜单里的展示名。 */
export interface DragonColorOption {
	key: string;
	label: string;
}

export interface DragonMenuOptions {
	theme: Theme;
	/** 可选配色，按数组顺序循环。 */
	colors: DragonColorOption[];
	/** 当前配色对应的展示名（对不上任何一个时循环会从第一个开始）。 */
	colorValue: string;
	/** 输出染色是否开启（markdown 跟随边框色）。 */
	outputTint: boolean;
	/** 边框当前的样式（圆角 / 横线）。 */
	frameStyle: FrameStyle;
	/** 输入框行首当前的提示符。 */
	promptGlyph: PromptGlyph;
	/** 「收起思考」当前的显示方式。 */
	thinkingMode: ThinkingMode;
	/** 循环到某个配色后回调（传 key），菜单保持打开。 */
	onColor: (key: string) => void;
	/** 切换输出染色开关后回调，菜单保持打开。 */
	onOutputTint: (enabled: boolean) => void;
	/** 切换边框样式后回调，菜单保持打开。 */
	onFrameStyle: (style: FrameStyle) => void;
	/** 把提示符切到某个值后回调，菜单保持打开。 */
	onPromptGlyph: (glyph: PromptGlyph) => void;
	/** 把思考显示方式切到某个值后回调，菜单保持打开。 */
	onThinking: (mode: ThinkingMode) => void;
}

/**
 * `/dragon` 根菜单：一个设置页。
 *
 * 每一项都是「值项」——光标移上去按空格 / 回车就地循环，不打开子菜单、不关菜单。
 */
export class DragonMenu implements Component, Focusable {
	private readonly container = new Container();
	private readonly list: SettingsList;
	private _focused = false;

	constructor(options: DragonMenuOptions, onClose: () => void) {
		// SettingsList 用 values.indexOf(currentValue) 定位，所以 values 得和右侧显示的文字一致。
		const colorLabels = options.colors.map((c) => c.label);
		const byLabel = new Map(options.colors.map((c) => [c.label, c.key]));
		const tintLabels = ["on", "off"];
		const tintByLabel = new Map([
			["on", true],
			["off", false],
		]);
		const frameLabels = FRAME_STYLES.map((style) => FRAME_STYLE_LABELS[style]);
		const frameByLabel = new Map(
			FRAME_STYLES.map((style) => [FRAME_STYLE_LABELS[style], style]),
		);
		const thinkingLabels = THINKING_MODES.map((mode) => THINKING_MODE_LABELS[mode]);
		const thinkingByLabel = new Map(
			THINKING_MODES.map((mode) => [THINKING_MODE_LABELS[mode], mode]),
		);
		const promptLabels = PROMPT_GLYPHS.map((glyph) => PROMPT_GLYPH_LABELS[glyph]);
		const promptByLabel = new Map(
			PROMPT_GLYPHS.map((glyph) => [PROMPT_GLYPH_LABELS[glyph], glyph]),
		);
		// 配置里可能是老版本 / 手写的未知字形：SettingsList 的 currentValue 必须是字符串，
		// 查不到标签就退回原值并补进 values，否则 render 时 truncateToWidth(undefined) 会崩。
		const promptValue = PROMPT_GLYPH_LABELS[options.promptGlyph] ?? options.promptGlyph;
		if (!promptLabels.includes(promptValue)) {
			promptLabels.push(promptValue);
			promptByLabel.set(promptValue, options.promptGlyph);
		}

		const items: SettingItem[] = [
			{
				id: "color",
				label: "Border color",
				description: "Editor / modal border color. Space or Enter cycles it.",
				currentValue: options.colorValue,
				values: colorLabels,
			},
			{
				id: "tint",
				label: "Output tint",
				description:
					"Tint assistant markdown toward the border color: headings, links, inline code, code-block body/fences, quotes, rules, list bullets, plus a faint body wash. Syntax highlighting stays native.",
				currentValue: options.outputTint ? "on" : "off",
				values: tintLabels,
			},
			{
				id: "frame",
				label: "Frame style",
				description:
					"`rounded` draws the ╭╮╰╯ box; `lines` drops the side bars and keeps only the top/bottom rules (pi's native look). Applies to the editor and every custom() modal.",
				currentValue: FRAME_STYLE_LABELS[options.frameStyle],
				values: frameLabels,
			},
			{
				id: "thinking",
				label: "Collapsed thinking",
				description:
					"Live reasoning lines under pi's `Thinking...` header: `1 line` / `2 lines`, or `hidden` for the native header only.",
				currentValue: THINKING_MODE_LABELS[options.thinkingMode],
				values: thinkingLabels,
			},
			{
				id: "prompt",
				label: "Prompt glyph",
				description:
					"Glyph at the start of the editor's first line: `>` / `_`, or `hidden` for none. Wrapped lines keep the indent.",
				currentValue: promptValue,
				values: promptLabels,
			},
		];

		this.list = new SettingsList(
			items,
			items.length,
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "color") {
					const key = byLabel.get(newValue);
					if (key !== undefined) options.onColor(key);
					return;
				}
				if (id === "tint") {
					const enabled = tintByLabel.get(newValue);
					if (enabled !== undefined) options.onOutputTint(enabled);
					return;
				}
				if (id === "frame") {
					const style = frameByLabel.get(newValue);
					if (style !== undefined) options.onFrameStyle(style);
					return;
				}
				if (id === "thinking") {
					const mode = thinkingByLabel.get(newValue);
					if (mode !== undefined) options.onThinking(mode);
					return;
				}
				if (id === "prompt") {
					const glyph = promptByLabel.get(newValue);
					if (glyph !== undefined) options.onPromptGlyph(glyph);
				}
			},
			onClose,
		);

		this.container.addChild(new Spacer(1));
		this.container.addChild(
			new Text(options.theme.fg("accent", options.theme.bold("Dragon TUI")), 0, 0),
		);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.list);
	}

	/** 让 RoundedFrame 的 isFocusable() 认出来，焦点才会转发进来。 */
	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate();
	}

	handleInput(data: string): void {
		this.list.handleInput(data);
	}
}
