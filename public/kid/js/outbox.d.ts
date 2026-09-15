// Minimal ambient types for outbox.js, so src/kid-outbox.test.ts type-checks without pulling
// public/ JS into the tsconfig compile scope (allowJs stays off). Same arrangement as
// grow-gate.d.ts. Keep in sync with the JSDoc in outbox.js, which is the record.

/** One card off `state.chart.todayTasks`, in the fields the queue and `cardState` read. */
export interface OutboxCard {
  kind: string;
  taskRunId?: string;
  choreId?: string;
  runId?: string | null;
  runStatus?: string;
  status?: string;
  optional?: boolean;
}

/** "done" = the server has it (2xx or 409), "keep" = try again, "drop" = it never can. */
export function verdict(status: number): "done" | "keep" | "drop";

/** Mark the queued cards the way the server would have, in place. */
export function applyTaps(tasks: OutboxCard[] | undefined, queuedIds: string[]): void;
