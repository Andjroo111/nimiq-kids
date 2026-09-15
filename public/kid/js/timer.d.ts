// Minimal ambient types for timer.js so src/egg-timer.test.ts type-checks without
// pulling public/ JS into the tsconfig compile scope (allowJs stays off). Keep in
// sync with the JSDoc in timer.js — that file is the implementation of record.

export interface RemainingArgs {
  durationS: number;
  startedAtMs: number;
  nowMs: number;
  serverSkewMs?: number;
}

export interface Remaining {
  remainingMs: number;
  remainingS: number;
  progress: number;
  done: boolean;
}

export function computeRemaining(args: RemainingArgs): Remaining;

export interface CountdownArgs {
  durationS: number;
  startedAtMs?: number;
  serverSkewMs?: number;
  onTick?: (remainingS: number, progress01: number) => void;
  onDone?: () => void;
}

export interface Countdown {
  pause(): void;
  resume(): void;
  stop(): void;
}

export function createCountdown(args: CountdownArgs): Countdown;
