import { RegistryToolManifest } from "../registry/RegistryTypes";
import { Tool } from "./Tool";
import { ToolInstaller } from "./ToolInstaller";

type RegistryInstallInput = {
  id: string;
  version?: string;
};

type RegistryInstallOutput = {
  installed: boolean;
  manifest: RegistryToolManifest;
};

type ToolsRefresher = () => Promise<void>;

export class RegistryInstallTool
  implements Tool<RegistryInstallInput, RegistryInstallOutput> {
  name = "registry_install";
  description =
    "Install a registry tool. Input: { id: string, version?: string }";

  constructor(
    private readonly installer: ToolInstaller,
    private readonly refreshTools: ToolsRefresher
  ) { }

  async execute(input: RegistryInstallInput): Promise<RegistryInstallOutput> {
    const id = input?.id?.trim();
    if (!id) {
      throw new Error("Missing id");
    }
    const manifest = await this.installer.installFromRegistry(id, input?.version);
    await this.refreshTools();
    return { installed: true, manifest };
  }
}
