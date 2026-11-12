import type { OrderBoard, OrderEdge, SetOrderDependencyInput } from '../order/order.js';

/** Orchestration map and the gates on it. */
export interface OrderIpc {
  listOrder(): Promise<OrderBoard>;
  setOrderDependency(
    input: SetOrderDependencyInput,
  ): Promise<{ edge: OrderEdge; created: boolean }>;
  clearOrderDependency(id: string): Promise<void>;
  satisfyOrderDependency(id: string, satisfied?: boolean): Promise<OrderEdge>;
  onOrderChanged(listener: () => void): () => void;
}
