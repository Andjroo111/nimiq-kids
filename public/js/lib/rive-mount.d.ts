// Minimal ambient types for rive-mount.js so src/rive-mount.test.ts type-checks without
// pulling public/ JS into the tsconfig compile scope (allowJs stays off). Same pattern as
// esc.d.ts and box-glyphs.d.ts: rive-mount.js is the implementation of record.

export interface RiveInput { name: string; type: unknown; fire(): void }

export interface RiveInstance {
  resizeDrawingSurfaceToCanvas(): void;
  stateMachineInputs(name: string): RiveInput[];
  pause(): void;
  cleanup(): void;
}

export interface MountOptions {
  /** Hold the rest pose, no tap. Defaults to prefers-reduced-motion. */
  still?: boolean;
  createCanvas?: () => unknown;
  onResize?: (fn: () => void) => void;
  /** Replaces loadRuntime() in mountAll. */
  load?: () => Promise<unknown>;
}

/** Load the vendored runtime once; resolves to the global `rive` namespace. */
export function loadRuntime(kit?: string): Promise<unknown>;

/** The trigger named `verb`, or the first trigger when verb is blank. */
export function pickTrigger(inputs: RiveInput[] | null | undefined, verb: string, triggerType: unknown): RiveInput | null;

/** Mount one element; null when the file did not load. */
export function mountRive(el: unknown, rive: unknown, opts?: MountOptions): Promise<RiveInstance | null>;

/** Every set `[data-riv]` under root. */
export function mountAll(root?: unknown, opts?: MountOptions): Promise<(RiveInstance | null)[]>;
