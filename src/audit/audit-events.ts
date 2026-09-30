export type AuditOutcome = "SUCCEEDED" | "FAILED";

export interface AuditEvent {
  at: string;
  userId: string;
  action: string;
  outcome: AuditOutcome;
  workspaceId?: string;
  errorCode?: string;
}

export interface AuditEventSink {
  record(event: AuditEvent): Promise<void> | void;
}

export class InMemoryAuditEventSink implements AuditEventSink {
  readonly events: AuditEvent[] = [];
  record(event: AuditEvent): void { this.events.push(structuredClone(event)); }
}

export class JsonLineAuditEventSink implements AuditEventSink {
  constructor(private readonly write: (line: string) => void = (line) => console.error(line)) {}
  record(event: AuditEvent): void { this.write(JSON.stringify({ type: "audit", ...event })); }
}
