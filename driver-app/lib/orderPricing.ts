const DELIVERY_SERVICE_ID = 2;

type OrderLike = {
  serviceId?: number | null;
  service?: { id?: number | null; name?: string | null } | null;
  distanceKm?: number | null;
  estimatedPrice?: number | null;
  finalPrice?: number | null;
  pricePerKm?: number | string | null;
  isWaiting?: boolean | null;
  waitingStartedAt?: string | null;
  waitingAccumulatedSeconds?: number | null;
  waitingFee?: number | string | null;
};

export function isDeliveryOrder(order?: OrderLike | null): boolean {
  if (!order) return false;

  const serviceName = order.service?.name?.trim().toLowerCase() ?? "";
  return order.serviceId === DELIVERY_SERVICE_ID || order.service?.id === DELIVERY_SERVICE_ID || serviceName.includes("доставка");
}

export function mapOrderToActiveOrder<T extends OrderLike>(order: T, baseFare: number) {
  const isFixedPrice = isDeliveryOrder(order);
  const estimatedPrice =
    order.estimatedPrice === null || order.estimatedPrice === undefined
      ? null
      : Number(order.estimatedPrice);

  return {
    ...order,
    distanceKm: Number(order.distanceKm) || 0,
    currentPrice: isFixedPrice
      ? ((estimatedPrice ?? Number(order.finalPrice)) || 0)
      : (Number(order.finalPrice) || baseFare),
    estimatedPrice: estimatedPrice,
    isFixedPrice,
    pricePerKm: Number(order.pricePerKm) || 80,
    isWaiting: Boolean(order.isWaiting),
    waitingStartedAt: order.waitingStartedAt ?? null,
    waitingAccumulatedSeconds: Number(order.waitingAccumulatedSeconds) || 0,
    waitingFee: Number(order.waitingFee) || 0,
  };
}
