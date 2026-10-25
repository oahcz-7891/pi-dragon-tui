/**
 * 配色表 + 选择持久化。
 *
 * 这里是 `index.ts` 里 BORDER_HEX 之外的第二来源：
 *   - 启动时先读配置文件，有值就用它，没有就用 index.ts 的 BORDER_HEX；
 *   - `/dragon` 切换后写回配置文件，重启仍生效。
 *
 * 配置文件路径（按优先级）：
 *   1. `$PI_DRAGON_TUI_CONFIG`
 *   2. `<agent dir>/.dragon-tui.json`，agent dir 是 `$PI_CODING_AGENT_DIR`
 *      或默认的 `~/.pi/agent`
 *
 * 故意不写进扩展自己的目录：扩展目录可能是 git 仓库（会被 git status 看到），
 * 也可能是 pi install 下来的包（升级时被覆盖）。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ─────────────────────────────── 配色表 ───────────────────────────────

export interface Palette {
	/** 菜单里显示的 key（角色名）。 */
	key: string;
	/** 中文名，文档里用。 */
	label: string;
	/** 英文名，菜单文案里用。 */
	en: string;
	/** 6 位 hex，带 #。 */
	hex: string;
}

export const PALETTES: Palette[] = [
	{
		key: "goku",
		label: "悟空金",
		en: "Goku gold",
		hex: "#f0c674",
	},
	{
		key: "vegeta",
		label: "贝吉塔蓝",
		en: "Vegeta blue",
		hex: "#7d9ed4",
	},
	{
		key: "piccolo",
		label: "短笛绿",
		en: "Piccolo green",
		hex: "#7fc95a",
	},
];

// ─────────────────────────────── 解析 ───────────────────────────────

/** 校验 6 位 hex（必须带 #）。 */
export function isValidHex(value: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(value);
}

// ─────────────────────────────── 落盘 ───────────────────────────────

/** 配置文件完整路径。 */
export function configPath(): string {
	const override = process.env.PI_DRAGON_TUI_CONFIG?.trim();
	if (override) return override;
	const agentDir =
		process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	return join(agentDir, ".dragon-tui.json");
}

/** 读取整个配置文件；文件不存在 / JSON 坏了 → 空对象。 */
function readConfig(): Record<string, unknown> {
	try {
		const parsed = JSON.parse(readFileSync(configPath(), "utf8")) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * 合并写入配置文件（保留其它字段，比如 borderHex）。
 * 成功返回 undefined，失败返回错误信息（不抛，免得把命令打断）。
 */
function writeConfig(patch: Record<string, unknown>): string | undefined {
	try {
		const target = configPath();
		mkdirSync(dirname(target), { recursive: true });
		const merged = { ...readConfig(), ...patch };
		writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

/** 读取记住的 hex；文件不存在、JSON 坏了、值不合法，一律当没设置。 */
export function readSavedHex(): string | undefined {
	const hex = readConfig().borderHex;
	return typeof hex === "string" && isValidHex(hex) ? hex.toLowerCase() : undefined;
}

/** 写入记住的 hex。 */
export function saveHex(hex: string): string | undefined {
	return writeConfig({ borderHex: hex });
}

// ─────────────────────── 收起思考的显示方式 ───────────────────────

/**
 * 收起（ctrl+T 隐藏）时思考块怎么画：
 *   "line1"   pi 原生标题 "Thinking..." + 1 行实时内容
 *   "line2"   pi 原生标题 "Thinking..." + 2 行实时内容
 *   "hidden"  只显示 pi 原生那行 "Thinking..."（不加任何实时内容）
 */
export type ThinkingMode = "line1" | "line2" | "hidden";

/** 固定的菜单循环顺序。 */
export const THINKING_MODES: readonly ThinkingMode[] = ["line1", "line2", "hidden"];

/**
 * 菜单右侧 / 通知里显示的文案。
 * “行”只算实时内容，不含 pi 原生那行 `Thinking...`；hidden = 只有原生那行。
 */
export const THINKING_MODE_LABELS: Record<ThinkingMode, string> = {
	line1: "1 line",
	line2: "2 lines",
	hidden: "hidden",
};

/** 配置文件里手写 thinkingMode 时的容错解析；认不出来 → undefined（用默认值）。 */
export function parseThinkingMode(input: string): ThinkingMode | undefined {
	switch (input.trim().toLowerCase()) {
		case "1":
		case "1line":
		case "line1":
		case "one":
			return "line1";
		case "2":
		case "2lines":
		case "line2":
		case "two":
			return "line2";
		case "0":
		case "hide":
		case "hidden":
		case "native":
		case "none":
		case "off":
			return "hidden";
		default:
			return undefined;
	}
}

function isThinkingMode(value: string): value is ThinkingMode {
	return (THINKING_MODES as readonly string[]).includes(value);
}

/**
 * 读取记住的思考显示方式；没存过 → undefined（用 index.ts 的常量默认）。
 * 兼容老配置：
 *   - v0.1 存的是布尔值 `collapsedThinking`（true = 标题 + 1 行内容，false = 只有原生标题）；
 *   - 过渡期存过 "off" 表示只留原生标题，这里换算成 "hidden"。
 */
export function readSavedThinkingMode(): ThinkingMode | undefined {
	const config = readConfig();
	const value = config.thinkingMode;
	if (typeof value === "string") {
		if (isThinkingMode(value)) return value;
		if (value === "off" || value === "native") return "hidden";
	}
	const legacy = config.collapsedThinking;
	if (typeof legacy === "boolean") return legacy ? "line1" : "hidden";
	return undefined;
}

/** 写入思考显示方式（菜单里的 Collapsed thinking 改的就是它）。 */
export function saveThinkingMode(mode: ThinkingMode): string | undefined {
	return writeConfig({ thinkingMode: mode });
}

// ─────────────────────── 边框样式（圆角 / 横线） ───────────────────────

/**
 * 输入框与 `ctx.ui.custom()` 弹窗的边框样式：
 *   "rounded"  ╭────────╮
 *              │ > 输入  │
 *              ╰────────╯
 *   "line"     ────────────
 *               > 输入
 *              ────────────
 * 即 "line" 只保留上下两条横线，去掉左右竖线（pi 原生观感）。
 */
export type FrameStyle = "rounded" | "line";

/** 固定的菜单循环顺序。 */
export const FRAME_STYLES: readonly FrameStyle[] = ["rounded", "line"];

/** 菜单右侧 / 通知里显示的文案。 */
export const FRAME_STYLE_LABELS: Record<FrameStyle, string> = {
	rounded: "rounded",
	line: "lines",
};

/** 配置文件里手写 frameStyle 时的容错解析；认不出来 → undefined（用默认值）。 */
export function parseFrameStyle(input: string): FrameStyle | undefined {
	switch (input.trim().toLowerCase()) {
		case "rounded":
		case "round":
		case "corner":
		case "corners":
			return "rounded";
		case "line":
		case "lines":
		case "flat":
		case "plain":
		case "native":
		case "none":
			return "line";
		default:
			return undefined;
	}
}

/**
 * 读取记住的边框样式；没存过 → undefined（用 index.ts 的默认值）。
 * 走 parseFrameStyle，所以手写配置用菜单里显示的 "lines" 也能认。
 */
export function readSavedFrameStyle(): FrameStyle | undefined {
	const value = readConfig().frameStyle;
	return typeof value === "string" ? parseFrameStyle(value) : undefined;
}

/** 写入边框样式（菜单里的 Frame style 改的就是它）。 */
export function saveFrameStyle(style: FrameStyle): string | undefined {
	return writeConfig({ frameStyle: style });
}

// ─────────────────────── 输入框提示符（prompt glyph） ───────────────────────

/**
 * 输入框第一行行首画什么：
 *   "none"  不画（内容顶头开始）
 *   ">"     半角大于号
 *   "_"     下划线
 * 续行缩进按它的实际宽度自动算，所以换行后上下文字始终对齐。
 */
export type PromptGlyph = "none" | ">" | "_";

/** 固定的菜单循环顺序。 */
export const PROMPT_GLYPHS: readonly PromptGlyph[] = ["none", ">", "_"];

/** 菜单右侧 / 通知里显示的文案。 */
export const PROMPT_GLYPH_LABELS: Record<PromptGlyph, string> = {
	none: "hidden",
	">": ">",
	"_": "_",
};

/** 配置文件里手写 promptGlyph 时的容错解析；认不出来 → undefined（用默认值）。 */
export function parsePromptGlyph(input: string): PromptGlyph | undefined {
	switch (input.trim().toLowerCase()) {
		case "0":
		case "off":
		case "none":
		case "hide":
		case "hidden":
		case "no":
		case "empty":
			return "none";
		case ">":
		case "gt":
		case "angle":
		case "chevron":
		case "greater":
			return ">";
		case "_":
		case "underscore":
		case "low":
		case "dash":
		case "line":
			return "_";
		// 兼容旧配置：以前存过 "❯"，现在统一映射到 "_"。
		case "❯":
		case "arrow":
		case "heavy":
		case "bold":
			return "_";
		default:
			return undefined;
	}
}

/**
 * 读取记住的提示符；没存过 → undefined（用 index.ts 的默认值）。
 * 走 parsePromptGlyph，所以手写配置用菜单里显示的 "hidden" 也能认。
 */
export function readSavedPromptGlyph(): PromptGlyph | undefined {
	const value = readConfig().promptGlyph;
	return typeof value === "string" ? parsePromptGlyph(value) : undefined;
}

/** 写入提示符（菜单里的 Prompt glyph 改的就是它）。 */
export function savePromptGlyph(glyph: PromptGlyph): string | undefined {
	return writeConfig({ promptGlyph: glyph });
}

// ─────────────────────── 输出染色（markdown 跟随边框色） ───────────────────────

/**
 * 「输出染色」开关：
 *   true   助理消息的 markdown 强调色 / 正文往 borderHex 上靠（见 tint.ts）；
 *   false  保持 pi 原生配色。
 * 默认值在 index.ts 的 OUTPUT_TINT_DEFAULT，这里只管读写配置。
 */
export function readSavedOutputTint(): boolean | undefined {
	const value = readConfig().outputTint;
	if (typeof value === "boolean") return value;
	// 手写配置容错："on" / "off" / "true" / "false" 都认。
	if (typeof value === "string") {
		switch (value.trim().toLowerCase()) {
			case "on":
			case "true":
			case "yes":
			case "1":
				return true;
			case "off":
			case "false":
			case "no":
			case "0":
				return false;
		}
	}
	return undefined;
}

/** 写入输出染色开关（菜单里的 Output tint 改的就是它）。 */
export function saveOutputTint(enabled: boolean): string | undefined {
	return writeConfig({ outputTint: enabled });
}
