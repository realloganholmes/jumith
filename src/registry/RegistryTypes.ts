export type RegistryToolSummary = {
  id: string;
  name: string;
  version: string;
  summary: string;
  tags?: string[];
  provider?: string;
  requiresApproval?: boolean;
  requiredSecrets?: string[];
};

export type RegistryToolManifest = {
  id: string;
  name: string;
  version: string;
  summary: string;
  description: string;
  tags?: string[];
  provider?: string;
  entry: {
    runtime: "node";
    main: string;
    export?: string;
  };
  schema?: {
    input?: unknown;
    output?: unknown;
  };
  requiresApproval?: boolean;
  requiredSecrets?: string[];
};

export type RegistryToolBundleFile = {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
};

export type RegistryToolBundle = {
  manifest: RegistryToolManifest;
  files: RegistryToolBundleFile[];
};

export type RegistrySearchResult = {
  results: RegistryToolSummary[];
  total: number;
};
