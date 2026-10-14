import { performance } from "node:perf_hooks";

/** Passive timing; logs only operation name, duration and success/failure. */
export async function timedOperation<T>(operation: string, callback: () => Promise<T>): Promise<T> {
  const start = performance.now();
  let status: "success" | "failure" = "failure";
  try {
    const result = await callback();
    status = "success";
    return result;
  } finally {
    try {
      console.info(JSON.stringify({
        event: "agent_workspace_operation_timing",
        operation,
        status,
        durationMs: Math.round((performance.now() - start) * 100) / 100
      }));
    } catch {
      // Diagnostic output must never change the outcome of an operation.
    }
  }
}

/** Best-effort logging for synchronous operations. */
export function logSynchronousTiming(operation: string, start: number): void {
  try {
    console.info(JSON.stringify({
      event: "agent_workspace_operation_timing",
      operation,
      status: "success",
      durationMs: Math.round((performance.now() - start) * 100) / 100
    }));
  } catch {
    // Logging must not affect business operations.
  }
}
