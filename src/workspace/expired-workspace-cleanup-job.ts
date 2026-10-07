import type { ExecutionProviderFactory } from "../execution/execution-provider-factory.js";
import type { ExecutionAccountRepository, WorkspaceRepository } from "../persistence/repositories.js";
import type { ObjectStore } from "../storage/object-store.js";

export class ExpiredWorkspaceCleanupJob {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly accounts: ExecutionAccountRepository,
    private readonly providerFactory: ExecutionProviderFactory,
    private readonly now: () => Date = () => new Date(),
    private readonly objectStore?: ObjectStore
  ) {}

  async run(limit = 100): Promise<{ processed: number; failed: number }> {
    const expired = await this.workspaces.listExpiredActive(this.now().toISOString(), limit);
    let processed = 0;
    let failed = 0;
    for (const workspace of expired) {
      try {
        if (workspace.providerId && workspace.providerWorkspaceId) {
          const account = await this.accounts.findByUserId(workspace.userId);
          if (!account || account.status !== "CONNECTED") throw new Error("Execution account unavailable for cleanup");
          const provider = await this.providerFactory.createForAccount(account);
          await provider.terminate({
            providerId: workspace.providerId,
            providerWorkspaceId: workspace.providerWorkspaceId
          });
        }
      } catch {
        failed += 1;
      } finally {
        const {
          providerId: _providerId,
          providerWorkspaceId: _providerWorkspaceId,
          ...logicalWorkspace
        } = workspace;
        await this.workspaces.upsert({
          ...logicalWorkspace,
          status: "EXPIRED",
          destroyedAt: this.now().toISOString()
        });
        await this.objectStore?.deletePrefix(`workspaces/${workspace.userId}/${workspace.id}/`).catch(() => undefined);
        processed += 1;
      }
    }
    return { processed, failed };
  }
}
