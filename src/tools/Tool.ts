export interface Tool<Input, Output> {
  name: string;
  description: string;
  execute(input: Input): Promise<Output>;
}
