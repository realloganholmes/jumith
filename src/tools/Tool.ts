export type ToolExecutionContext = {
  toolName: string;
  env: Record<string, string>;
};

export interface Tool<Input, Output> {
  name: string;
  description: string;
  requiredSecrets?: string[];
  requiresApproval?: boolean;
  getApprovalMessage?(input: Input): string;
  execute(input: Input, context?: ToolExecutionContext): Promise<Output>;
}
