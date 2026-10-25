/**
 * RoundedFrame — 给任意 `ctx.ui.custom()` 组件套一层边框（圆角 / 纯横线）。
 *
 * 为什么能覆盖“别人的”弹框：
 *   pi 每个 session 只 `createExtensionUIContext()` 一次，并把同一个 uiContext
 *   对象交给所有扩展；每个扩展的 `ctx.ui` 是一个 getter，返回的正是这个共享对象
 *   （见 dist/core/extensions/runner.js）。所以把 `ui.custom` 换成包装版，之后
 *   任何扩展调用 `ctx.ui.custom()` 都会经过这里。
 *
 * 注意：
 *   - 只管 `custom()`；内置的 select/confirm/input/editor 不走这里。
 *   - 如果某个扩展先把 `ctx.ui.custom` 存成变量再调用，就绕过了包装。
 *   - `/reload` 会重建 uiContext，所以每次 session_start 都要重新安装（见 index.ts）。
 */

import {
	isFocusable,
	truncateToWidth,
	visibleWidth,
	type Component,
	type Focusable,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

/** 只取用到的 theme 字段，避免依赖未导出的内部类型。 */
type ThemeLike = { fg(color: string, text: string): string };
type ColorFn = (text: string) => string;

/**
 * 边框样式：
 *   "rounded"  ╭────╮ / │ 内容 │ / ╰────╯
 *   "line"     只画上下两条横线，去掉左右 │（pi 原生观感）
 * 与 palette.ts 的 FrameStyle 取值一致（故意不 import，保持本文件可单独拷走）。
 */
export type FrameCornerStyle = "rounded" | "line";

/** 允许传固定值，也允许传 getter 以便 /dragon 运行时切换。 */
type FrameStyleSource = FrameCornerStyle | (() => FrameCornerStyle);

/** 把配置值统一成每次渲染都重新求值的 getter。 */
function frameStyleGetter(value: FrameStyleSource | undefined): () => FrameCornerStyle {
	return typeof value === "function" ? value : () => value ?? "rounded";
}

export interface RoundedDialogsConfig {
	/** 边框颜色名（theme.fg 的 key），如 "accent" / "border"。传了 border 时忽略。 */
	borderColor: string;
	/** 直接指定着色函数（优先级高于 borderColor），可用来跟编辑器边框同色。 */
	border?: ColorFn;
	/** 边框与内容之间的水平间距，默认 1。 */
	paddingX: number;
	/** 上下各加几行空行，默认 0。 */
	paddingY: number;
	/** 只给 overlay 浮层套框；true 时非浮层的 custom UI 保持原样。 */
	overlayOnly: boolean;
	/**
	 * pi 的弹窗组件习惯画一条 DynamicBorder（一整行 `─`）当顶部装饰、
	 * 再在底部画一条，套上圆角框就会变成「框里还有两条横线」。
	 * true（默认）时砍掉顶部第一行与底部的装饰横线；想保留原生观感就设 false。
	 * 底部不是只看最后一行 —— 有些弹窗（ask-user-question）把 footer
	 * 放在底边框后面，需要往尾部回扫，见 stripEdgeRules()。
	 */
	stripInnerRules?: boolean;
	/**
	 * 边框样式；传函数可运行时切换（/dragon 菜单里的 Frame style）。默认 "rounded"。
	 * "line" 时只留上下两条横线，没有左右竖线，内容用满整宽（paddingX 留白照旧）。
	 * 注意：line 样式下会强制 stripInnerRules（否则内层分隔线与外框横线宽度不一致，看着像重影）。
	 */
	frameStyle?: FrameStyleSource;
}

/** 去掉 ANSI 转义后是否只剩横线字符（pi 的 DynamicBorder 就是整行 `─`）。 */
function isRuleLine(line: string): boolean {
	const plain = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim();
	return plain.length > 0 && /^[─━═]+$/.test(plain);
}

/**
 * 砍掉内层组件自带的上下装饰横线。
 *
 * - 顶部：只认渲染结果的第一行。
 * - 底部：不能只看最后一行。pi 自带的 select / input / editor 弹窗把
 *   DynamicBorder 放在最后一行，但 ask-user-question 那类是
 *   `[..., 底部 border, Spacer(1), 提示行]`（见其 dialog-builder.ts:266-267），
 *   而且弹窗还会用空行把高度补齐。所以从末尾往前扫：空行无限跳过
 *   （那只是补高），非空行最多跳过 footerLookahead 行（footer 提示），
 *   碰到第一条纯横线就删；超过预算就放弃，不当成装饰线。
 *
 * 如果整块内容都是横线（例如组件本身就是个分隔条），原样返回，
 * 免得渲染出一个只有空壳的盒子。
 */
function stripEdgeRules(lines: readonly string[], footerLookahead = 4): readonly string[] {
	if (lines.length === 0) return lines;
	const out = lines.slice();

	if (isRuleLine(out[0]!)) out.shift();

	let footerRows = 0;
	for (let i = out.length - 1; i >= 0; i--) {
		const line = out[i]!;
		if (isRuleLine(line)) {
			out.splice(i, 1);
			break;
		}
		if (line.trim() !== "" && ++footerRows > footerLookahead) break;
	}

	return out.length > 0 ? out : lines;
}

interface DisposableComponent extends Component {
	dispose?: () => void;
	/** overlay 在没有 overlayOptions 时会读它来推断宽度。 */
	width?: number;
	wantsKeyRelease?: boolean;
}

/** 边框容器：把内层组件渲染进 ╭─╮ / ╰─╯（或纯横线）里，并转发焦点与输入。 */
export class RoundedFrame implements Component, Focusable {
	private readonly inner: DisposableComponent;
	private readonly border: ColorFn;
	private readonly paddingX: number;
	private readonly paddingY: number;
	private readonly stripInnerRules: boolean;
	private readonly frameStyle: () => FrameCornerStyle;
	private _focused = false;

	constructor(
		inner: DisposableComponent,
		options: {
			border: ColorFn;
			paddingX: number;
			paddingY: number;
			stripInnerRules?: boolean;
			frameStyle?: FrameStyleSource;
		},
	) {
		this.inner = inner;
		this.border = options.border;
		this.paddingX = Math.max(0, options.paddingX);
		this.paddingY = Math.max(0, options.paddingY);
		this.stripInnerRules = options.stripInnerRules ?? true;
		this.frameStyle = frameStyleGetter(options.frameStyle);
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		// 转发给内层，内层才会输出 CURSOR_MARKER，IME 光标才不会错位。
		if (isFocusable(this.inner)) {
			(this.inner as Component & Focusable).focused = value;
		}
	}

	/** 让 overlay 的宽度推断把边框算进去（line 样式没有左右竖线，少 2 列）。 */
	get width(): number | undefined {
		const w = this.inner.width;
		if (typeof w !== "number") return undefined;
		return w + 2 * this.paddingX + (this.frameStyle() === "rounded" ? 2 : 0);
	}

	get wantsKeyRelease(): boolean {
		return this.inner.wantsKeyRelease ?? false;
	}

	invalidate(): void {
		this.inner.invalidate?.();
	}

	dispose(): void {
		this.inner.dispose?.();
	}

	handleInput(data: string): void {
		this.inner.handleInput?.(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return this.inner.handleMouse?.(event);
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, Math.floor(width));
		const rounded = this.frameStyle() === "rounded";
		// 圆角框太窄画不下左右竖线，直接透传，免得把别人组件挤坏。
		if (rounded && safeWidth < 4) {
			return this.inner.render(safeWidth);
		}

		// line 样式没有左右竖线，内层可以直接用满整宽。
		const innerWidth = rounded ? safeWidth - 2 : safeWidth;
		// 极窄时把左右留白收掉，保证 pad + 内容 + pad 刚好等于 innerWidth。
		const padWidth = Math.min(
			this.paddingX,
			Math.max(0, Math.floor((innerWidth - 1) / 2)),
		);
		const contentWidth = Math.max(1, innerWidth - padWidth * 2);
		const pad = " ".repeat(padWidth);
		const side = rounded ? this.border("│") : "";
		const blank = side + " ".repeat(innerWidth) + side;

		const top = rounded
			? this.border(`╭${"─".repeat(innerWidth)}╮`)
			: this.border("─".repeat(safeWidth));
		const bottom = rounded
			? this.border(`╰${"─".repeat(innerWidth)}╯`)
			: top;

		const lines: string[] = [top];
		for (let i = 0; i < this.paddingY; i++) lines.push(blank);

		const rendered = this.inner.render(contentWidth);
		// 内层自带的上下横线（DynamicBorder）在这里各砍一行，只留外框一条边。
		// line 样式必须砍：外框横线是整宽的，留着内层那条会变成两条不同宽度的横线。
		const strip = this.stripInnerRules || !rounded;
		for (const raw of strip ? stripEdgeRules(rendered) : rendered) {
			// 只在超宽时才截断，避免误伤 CURSOR_MARKER 等零宽序列。
			const clipped = visibleWidth(raw) > contentWidth ? truncateToWidth(raw, contentWidth, "") : raw;
			const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
			// 边框字符单独上色，别把颜色串到内层内容上。
			lines.push(side + pad + clipped + fill + pad + side);
		}

		for (let i = 0; i < this.paddingY; i++) lines.push(blank);
		lines.push(bottom);
		return lines;
	}
}

/** 标记：同一个 uiContext 只包装一次，防止 reload/重复 session_start 叠加多层。 */
const PATCH_FLAG = Symbol.for("pi-dragon-tui.rounded-custom");

/**
 * 把共享的 `ctx.ui.custom` 换成包装版。对同一个对象重复调用是幂等的。
 * 返回 true 表示本次真的装上了（或已装过）。
 */
export function installRoundedCustom(
	ui: unknown,
	theme: ThemeLike,
	config: RoundedDialogsConfig,
): boolean {
	const target = ui as Record<PropertyKey, unknown> & {
		custom?: (factory: unknown, options?: unknown) => unknown;
	};
	if (typeof target.custom !== "function" || target[PATCH_FLAG]) {
		return false;
	}

	const original = target.custom;

	target.custom = function (this: unknown, factory: unknown, options?: unknown) {
		const overlayOnly = config.overlayOnly;
		const isOverlay =
			!!options && typeof options === "object" && (options as { overlay?: boolean }).overlay === true;
		if (overlayOnly && !isOverlay) {
			return original.call(this, factory, options);
		}

		const wrapped = (tui: unknown, currentTheme: unknown, keybindings: unknown, done: unknown) => {
			const t = (currentTheme as ThemeLike | undefined) ?? theme;
			const frame = (component: DisposableComponent) =>
				new RoundedFrame(component, {
					border: config.border ?? ((text) => t.fg(config.borderColor, text)),
					paddingX: config.paddingX,
					paddingY: config.paddingY,
					stripInnerRules: config.stripInnerRules,
					frameStyle: config.frameStyle,
				});

			const result = (factory as (...a: unknown[]) => unknown)(tui, currentTheme, keybindings, done);
			// custom() 的 factory 允许返回 Promise<Component>。
			return result && typeof (result as PromiseLike<unknown>).then === "function"
				? (result as Promise<DisposableComponent>).then(frame)
				: frame(result as DisposableComponent);
		};

		return original.call(this, wrapped, options);
	};

	target[PATCH_FLAG] = true;
	return true;
}
