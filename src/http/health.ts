export interface HealthStatus {
  status: "ok" | "unavailable";
  service: "agent-workspace";
  version: string;
  database?: "ok" | "unavailable";
}

export interface HealthDependencies {
  version: string;
  checkDatabase(): Promise<void>;
}

export async function handleHealthRequest(
  request: Request,
  deps: HealthDependencies
): Promise<Response | undefined> {
  const url = new URL(request.url);

  if (request.method !== "GET") return undefined;

  if (url.pathname === "/health") {
    return Response.json({
      status: "ok",
      service: "agent-workspace",
      version: deps.version
    } satisfies HealthStatus, {
      headers: noStoreHeaders()
    });
  }

  if (url.pathname === "/ready") {
    try {
      await deps.checkDatabase();
      return Response.json({
        status: "ok",
        service: "agent-workspace",
        version: deps.version,
        database: "ok"
      } satisfies HealthStatus, {
        headers: noStoreHeaders()
      });
    } catch {
      return Response.json({
        status: "unavailable",
        service: "agent-workspace",
        version: deps.version,
        database: "unavailable"
      } satisfies HealthStatus, {
        status: 503,
        headers: noStoreHeaders()
      });
    }
  }

  return undefined;
}

function noStoreHeaders(): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  };
}
