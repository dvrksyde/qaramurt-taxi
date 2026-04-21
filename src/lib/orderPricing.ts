const DELIVERY_SERVICE_ID = 2;

type OrderLike = {
  serviceId?: number | null;
  service?: { id?: number | null; name?: string | null } | null;
};

export function isDeliveryOrder(order?: OrderLike | null): boolean {
  if (!order) return false;

  const serviceName = order.service?.name?.trim().toLowerCase() ?? "";
  return order.serviceId === DELIVERY_SERVICE_ID || order.service?.id === DELIVERY_SERVICE_ID || serviceName.includes("доставка");
}
