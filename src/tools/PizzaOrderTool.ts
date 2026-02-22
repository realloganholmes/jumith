import { Tool } from "./Tool";

type PizzaOrderInput = {
  name: string;
  address: string;
};

type PizzaOrderOutput = {
  orderId: string;
  message: string;
};

export class PizzaOrderTool implements Tool<PizzaOrderInput, PizzaOrderOutput> {
  name = "order_pizza";
  description =
    "Mock pizza order. Input: { name: string, address: string }";
  requiresApproval = true;

  async execute(input: PizzaOrderInput): Promise<PizzaOrderOutput> {
    const name = this.requireString(input?.name, "name");
    const address = this.requireString(input?.address, "address");
    const orderId = `pizza_${Date.now()}`;
    return {
      orderId,
      message: `Order placed for ${name} at ${address}.`,
    };
  }

  getApprovalMessage(input: unknown): string {
    const record = input as PizzaOrderInput;
    const name = this.requireString(record?.name, "name");
    const address = this.requireString(record?.address, "address");
    return `Approve pizza order for ${name} at ${address}?`;
  }

  private requireString(value: unknown, label: string): string {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    throw new Error(`Missing ${label}`);
  }
}
