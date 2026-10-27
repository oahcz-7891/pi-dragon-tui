/**
 * 输出染色 —— 让 pi 的 markdown 输出跟着 /dragon 选中的主题色走。
 *
 * 现状：pi 的 `getMarkdownTheme()` 每次渲染都调 `theme.fg("mdHeading" / "mdCode" / …)`，
 * 颜色来自当前 pi 主题（dark / light / system），跟 /dragon 的边框色没关系。
 * 这里在运行时把两类东西接到主题色上：
 *
 *   1. markdown 强调色（md*）—— 色相全部旋到主题色；每个 token 保留自己的
 *      亮度，再按角色做层级偏移（链接最亮、代码块围栏最暗；亮色主题方向相反），
 *      饱和度 = 主题色饱和度 × 权重。层级不塌。
 *      例外：`mdHeading` 不旋色，按主题明暗写死白 / 黑（见 HEADING_FIXED）。
 *   2. 正文 —— pi 给助理消息的 Markdown 传的 defaultTextStyle 是 undefined，
 *      纯文本因此是终端默认色。这里在 Markdown 的 applyDefaultStyle 上补一层
 *      很淡的主题色（sRGB 空间混 12%，见 tint-preview.html），只作用于
 *      「没有自带颜色」的 Markdown，用户消息（自带 userMessageText 颜色）不受影响。
 *   3. 代码块语法高亮不参与染色（syntax* token 不在表里，原样保留）。
 *
 * 为什么不 new Theme(...) + ctx.ui.setTheme()：
 *   - 运行中的 pi 是 bundle，扩展 import 进来的 Theme 类跟宿主不是同一个类对象，
 *     setTheme() 里的 `instanceof Theme` 会判假，把实例当主题名去加载而回退；
 *   - 换主题实例还会停掉主题文件 watcher、把主题名改成 <in-memory>，并覆盖
 *     /settings 里保存的 theme。
 * 所以这里只 patch 当前主题实例的 fg()，以及 Markdown 的 prototype：
 * 主题名、设置、HTML 导出都不动，卸载/关掉扩展即恢复原生配色。
 *
 * 生效时机（按需求）：session_start（启动 / 新会话 / /reload）、/dragon 菜单里换色、
 * 以及菜单里的 Output tint 开关（on / off，默认 off）。
 * 用户在 /settings 里换 pi 主题后不会自动重染，下次 /dragon 或 /reload 才重新接上。
 *
 * /reload 会重建整个扩展模块，但 prototype 只 patch 一次。所以变色状态放在
 * globalThis 的 store 里：老模块留下的 wrapper 每次都读 store，新模块只更新 store。
 */

import {
	colorToOkhsl,
	foregroundAnsi,
	mixColors,
	okhslColor,
	parseColor,
	type Color,
	type TerminalColorMode,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

// ───────────────────────────── 可调参数 ─────────────────────────────

/**
 * markdown 强调色的染色参数（与 tint-preview.html 一致）：
 *   weight    —— 饱和度权重：饱和度 = 主题色饱和度 × weight；
 *   lightness —— 亮度偏移：在原 token 亮度上加 / 减，做出层级（链接最亮）。
 * 偏移量按暗色主题写；亮色主题方向相反（越重要越暗），所以在 buildState 里取反。
 * 标题（mdHeading）不在表里：它不跟主题色走，固定用 HEADING_FIXED。
 */
const MD_TINT: Record<string, { weight: number; lightness: number }> = {
	mdLink: { weight: 0.9, lightness: 0.03 },
	mdCode: { weight: 0.85, lightness: 0 },
	mdListBullet: { weight: 0.8, lightness: 0.02 },
	mdCodeBlock: { weight: 0.65, lightness: -0.04 },
	mdHr: { weight: 0.4, lightness: -0.06 },
	mdQuote: { weight: 0.4, lightness: -0.06 },
	mdQuoteBorder: { weight: 0.4, lightness: -0.06 },
	mdLinkUrl: { weight: 0.35, lightness: -0.04 },
	mdCodeBlockBorder: { weight: 0.3, lightness: -0.06 },
};

/** 正文混入主题色的比例（0 = 终端默认色，1 = 纯主题色）。sRGB 空间混合，取 0.12。 */
const BODY_MIX = 0.12;

/**
 * 标题固定色（tint-heading-preview.html 的方案 A）：不参与旋色，直接写死。
 * 暗色主题纯白、亮色主题纯黑 —— 标题跟 /dragon 选的颜色无关。
 */
const HEADING_FIXED = { dark: "#ffffff", light: "#000000" } as const;

// ───────────────────────────── 全局状态 ─────────────────────────────

interface TintState {
	/** 来源 hex，仅用于诊断。 */
	hex: string;
	/** 终端颜色模式（truecolor / 256color）。 */
	mode: TerminalColorMode;
	/** markdown token → 染色后的颜色。 */
	tokens: Map<string, Color>;
	/** 正文颜色；undefined = 不染正文。 */
	body: Color | undefined;
}

interface TintStore {
	current?: TintState;
}

const TINT_STORE_KEY = Symbol.for("pi-dragon-tui.output-tint");
const FG_PATCHED = Symbol.for("pi-dragon-tui.output-tint.fg");
const MARKDOWN_PATCHED = Symbol.for("pi-dragon-tui.output-tint.markdown");

/** pi 主题单例挂在这些 globalThis symbol 上（新旧包名都认）。 */
const THEME_KEYS = [
	Symbol.for("@earendil-works/pi-coding-agent:theme"),
	Symbol.for("@mariozechner/pi-coding-agent:theme"),
];

function tintStore(): TintStore {
	const holder = globalThis as unknown as Record<symbol, TintStore | undefined>;
	return (holder[TINT_STORE_KEY] ??= {});
}

function findThemeInstance(): Theme | undefined {
	const holder = globalThis as unknown as Record<symbol, unknown>;
	for (const key of THEME_KEYS) {
		const instance = holder[key];
		if (instance && typeof instance === "object") return instance as Theme;
	}
	return undefined;
}

// ───────────────────────────── 染色计算 ─────────────────────────────

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

/**
 * 按主题色算一份染色表：
 *   - 强调色：色相 = 主题色色相，饱和度 = 主题色饱和度 × 权重，亮度 = token 原亮度；
 *   - 正文：终端默认正文色与主题色按 BODY_MIX 混合（oklch 空间，色相过渡自然）。
 */
function buildState(theme: Theme, hex: string): TintState {
	const mode = theme.getColorMode();
	// 亮色主题的层级方向相反：暗色主题「更亮 = 更重要」，亮色主题「更暗 = 更重要」。
	const dark = theme.appearance !== "light";
	const accent = colorToOkhsl(parseColor(hex));
	const colors = theme.colors as unknown as Record<string, Color>;

	const tokens = new Map<string, Color>();
	for (const [token, spec] of Object.entries(MD_TINT)) {
		const base = colors[token];
		if (!base) continue;
		// 亮度取原 token 的再偏移：亮底/暗底主题都不用另算对比度。
		const baseLightness = colorToOkhsl(base).l;
		const offset = dark ? spec.lightness : -spec.lightness;
		tokens.set(
			token,
			okhslColor(
				accent.h,
				clamp01(accent.s * spec.weight),
				clamp01(baseLightness + offset),
			),
		);
	}

	// 标题：不走旋色，按主题明暗写死白 / 黑（不再保留「最亮强调色」的层级位）。
	tokens.set("mdHeading", parseColor(dark ? HEADING_FIXED.dark : HEADING_FIXED.light));

	const textColor = colors["text"];
	const body = textColor
		? mixColors(textColor, parseColor(hex), BODY_MIX, "srgb")
		: undefined;

	return { hex, mode, tokens, body };
}

// ───────────────────────────── 主题 fg patch ─────────────────────────────

type FgFn = (this: Theme, token: string, text: string) => string;

/**
 * 把主题实例的 fg() 换成「染色表里有这个 token 就用染色值」。
 * 只 patch 一次；/reload 后 wrapper 继续读 globalThis store，所以新配色自动生效。
 */
function patchThemeFg(theme: Theme): void {
	const target = theme as unknown as Record<string | symbol, unknown>;
	if (target[FG_PATCHED]) return;
	const original = target["fg"];
	if (typeof original !== "function") return;

	target["fg"] = function (this: Theme, token: string, text: string): string {
		const state = tintStore().current;
		const color = state?.tokens.get(token);
		if (!color || !state) {
			return (original as FgFn).call(this, token, text);
		}
		return `${foregroundAnsi(color, state.mode)}${text}\x1b[39m`;
	};
	target[FG_PATCHED] = true;
}

// ───────────────────────────── Markdown 正文 patch ─────────────────────────────

/** 只按结构认 Markdown（bundle 里是内联类，import 的类身份对不上）。 */
interface MarkdownLike {
	text: string;
	defaultTextStyle?: unknown;
	render(width: number): string[];
	applyDefaultStyle(text: string): string;
	getDefaultStylePrefix(): string;
	renderToken(...args: unknown[]): string[];
}

function isMarkdownLike(value: unknown): value is MarkdownLike {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate["text"] === "string" &&
		typeof candidate["render"] === "function" &&
		typeof candidate["renderToken"] === "function" &&
		typeof candidate["applyDefaultStyle"] === "function" &&
		typeof candidate["getDefaultStylePrefix"] === "function"
	);
}

/**
 * 给运行时那份 Markdown prototype 打补丁：
 *   - applyDefaultStyle：没有 defaultTextStyle 时用正文染色包一层；
 *   - getDefaultStylePrefix：行内代码 / 粗体 / 链接 reset 之后重新接回正文色。
 * 用户消息自带 defaultTextStyle.color，走原实现，不动。
 */
function patchMarkdownPrototype(node: MarkdownLike): void {
	const proto = Object.getPrototypeOf(node) as Record<string | symbol, unknown> | null;
	if (!proto || proto[MARKDOWN_PATCHED]) return;

	const originalApply = proto["applyDefaultStyle"];
	const originalPrefix = proto["getDefaultStylePrefix"];
	if (typeof originalApply !== "function" || typeof originalPrefix !== "function") return;

	proto["applyDefaultStyle"] = function (this: MarkdownLike, text: string): string {
		const state = tintStore().current;
		if (!state || state.body === undefined || this.defaultTextStyle) {
			return (originalApply as (this: MarkdownLike, text: string) => string).call(this, text);
		}
		return `${foregroundAnsi(state.body, state.mode)}${text}\x1b[39m`;
	};

	proto["getDefaultStylePrefix"] = function (this: MarkdownLike): string {
		const state = tintStore().current;
		if (state && state.body !== undefined && !this.defaultTextStyle) {
			return foregroundAnsi(state.body, state.mode);
		}
		return (originalPrefix as (this: MarkdownLike) => string).call(this);
	};

	proto[MARKDOWN_PATCHED] = true;
}

/** 在 addChild / 组件树扫描时调用；结构不像 Markdown 就直接返回。 */
export function hookOutputTintMarkdown(component: unknown): void {
	try {
		if (isMarkdownLike(component)) patchMarkdownPrototype(component);
	} catch {
		// pi 内部结构变了就静默退回原生渲染。
	}
}

// ───────────────────────────── 对外入口 ─────────────────────────────

/**
 * 把输出接到 `hex` 这个主题色上。
 * 返回是否真的算出并装上了染色（主题没初始化 / 颜色解析失败时返回 false）。
 *
 * 调用后记得用 refreshOutputTint() 让 TUI invalidate + requestRender：
 * Markdown 会缓存渲染行，只 requestRender 不会丢掉旧颜色。
 */
export function applyOutputTint(theme: Theme, hex: string): boolean {
	try {
		const instance = findThemeInstance() ?? theme;
		const state = buildState(instance, hex);
		tintStore().current = state;
		patchThemeFg(instance);
		return true;
	} catch {
		return false;
	}
}

/**
 * 关掉染色：只清掉 store 里的状态，wrapper 读不到就退回原生主题色。
 * 主题实例上的 fg patch 留着（再打开时不用重装，也没有副作用）。
 */
export function clearOutputTint(): void {
	tintStore().current = undefined;
}

/**
 * 让已经渲染出来的内容用当前染色状态重画：遍历组件树 invalidate
 * （Markdown 缓存的渲染行在这里丢掉），最后强制 requestRender。
 */
export function refreshOutputTint(tui: unknown): void {
	if (!tui) return;
	const seen = new Set<unknown>();
	const stack: unknown[] = [tui];
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node || typeof node !== "object" || seen.has(node)) continue;
		seen.add(node);
		try {
			(node as { invalidate?: () => void }).invalidate?.();
		} catch {
			// 单个组件 invalidate 失败不影响别的节点。
		}
		const children = (node as { children?: unknown }).children;
		if (Array.isArray(children)) {
			for (const child of children) stack.push(child);
		}
	}
	(tui as { requestRender?: (force?: boolean) => void }).requestRender?.(true);
}
