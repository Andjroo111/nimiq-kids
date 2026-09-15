// Types for battery.js, for the tests (public/kid/js is untyped JS by design).
export interface BatteryFace { pct: number; charging: boolean; low: boolean; label: string }
export function batteryFace(level: number | undefined, charging: boolean): BatteryFace;
export function batteryHtml(face: BatteryFace): string;
export function mountBattery(nav?: Navigator): Promise<boolean>;
export function repaintBattery(): void;
