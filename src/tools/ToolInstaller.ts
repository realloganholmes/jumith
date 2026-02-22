import { RegistryClient } from "../registry/RegistryClient";
import { RegistryToolManifest } from "../registry/RegistryTypes";
import { LocalToolStore } from "./LocalToolStore";

export class ToolInstaller {
  constructor(
    private readonly registry: RegistryClient,
    private readonly store: LocalToolStore
  ) {}

  async installFromRegistry(
    id: string,
    version?: string
  ): Promise<RegistryToolManifest> {
    try {
      const targetVersion = version ?? (await this.registry.describeTool(id)).version;
      const bundle = await this.registry.downloadToolBundle(id, targetVersion);
      return await this.store.installBundle(bundle);
    } catch (error) {
      throw new Error(`Tool install failed: ${(error as Error).message}`);
    }
  }
}
