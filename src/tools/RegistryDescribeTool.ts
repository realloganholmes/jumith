import { RegistryClient } from "../registry/RegistryClient";
import { RegistryToolManifest } from "../registry/RegistryTypes";
import { Tool } from "./Tool";

type RegistryDescribeInput = {
  id: string;
};

type RegistryDescribeOutput = RegistryToolManifest;

export class RegistryDescribeTool
  implements Tool<RegistryDescribeInput, RegistryDescribeOutput> {
  name = "registry_describe";
  description = "Describe a registry tool. Input: { id: string }";

  constructor(private readonly registry: RegistryClient) { }

  async execute(input: RegistryDescribeInput): Promise<RegistryDescribeOutput> {
    const id = input?.id?.trim();
    if (!id) {
      throw new Error("Missing id");
    }
    return this.registry.describeTool(id);
  }
}
