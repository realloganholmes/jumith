export type ToolExecutionContext = {
  toolName: string;
  env: Record<string, string>;
};

/**
 * Tools can declare approval and secret requirements statically, or as a
 * function of the input so a single tool can support both a safe "quote"
 * action and a consequential "place" action (e.g. pricing vs placing an
 * order) with different gating.
 */
export type DynamicApproval<Input> = boolean | ((input: Input) => boolean);
export type DynamicSecrets<Input> = string[] | ((input: Input) => string[]);

export interface Tool<Input, Output> {
  name: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  requiredSecrets?: DynamicSecrets<Input>;
  requiresApproval?: DynamicApproval<Input>;
  getApprovalMessage?(input: Input): string;
  execute(input: Input, context?: ToolExecutionContext): Promise<Output>;
}

export function resolveRequiresApproval<Input>(
  tool: Tool<Input, unknown>,
  input: Input
): boolean {
  const flag = tool.requiresApproval;
  if (typeof flag === "function") {
    try {
      return Boolean(flag(input));
    } catch {
      // If the tool cannot decide, fail safe and require approval.
      return true;
    }
  }
  return Boolean(flag);
}

export function resolveRequiredSecrets<Input>(
  tool: Tool<Input, unknown>,
  input: Input
): string[] {
  const secrets = tool.requiredSecrets;
  if (typeof secrets === "function") {
    try {
      const resolved = secrets(input);
      return Array.isArray(resolved) ? resolved.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(secrets) ? secrets.filter(Boolean) : [];
}

/**
 * Secret names may be namespaced with a dot prefix (e.g. "payment.card_number").
 * Namespaced secrets are shared across tools so the user enters them once;
 * un-namespaced secrets stay scoped to the declaring tool.
 */
export function buildSecretKey(toolName: string, secretName: string): string {
  if (secretName.includes(".")) {
    return `shared-${secretName}`;
  }
  return `${toolName}-${secretName}`;
}

export function isSharedSecret(secretName: string): boolean {
  return secretName.includes(".");
}
