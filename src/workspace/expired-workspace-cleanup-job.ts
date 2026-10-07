import type { WorkspaceRepository } from "../persistence/repositories.js";
import type { ObjectStore } from "../storage/object-store.js";

export class ExpiredWorkspaceCleanupJob {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly objectStore?: ObjectStore
  ) {}

  async run(limit = 100): Promise<{ processed: number; failed: number }> {
    const expired = await this.workspaces.listExpiredActive(this.now().toISOString(), limit);
    let processed = 0;
    for (const workspace of expired) {
      await this.workspaces.upsert({
        ...workspace,
        status: "EXPIRED",
        destroyedAt: this.now().toISOString()
      });
      await this.objectStore?.deletePrefix(`workspaces/${workspace.userId}/${workspace.id}/`).catch(() => undefined);
      processed += 1;
    }
    return { processed, failed: 0 };
  }
}
