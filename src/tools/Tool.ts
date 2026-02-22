export interface Tool<Input, Output> {
  name: string;
  description: string;
  requiresApproval?: boolean;
  getApprovalMessage?(input: Input): string;
  execute(input: Input): Promise<Output>;
}
