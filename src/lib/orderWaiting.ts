const WAITING_RATE_PER_MIN = 20;

type WaitingOrderLike = {
  waitingStartedAt?: Date | string | null;
  waitingAccumulatedSeconds?: number | null;
  waitingFee?: number | string | null;
};

export function computeWaitingTotals(
  order: WaitingOrderLike,
  now = new Date()
): {
  waitingAccumulatedSeconds: number;
  waitingFee: number;
} {
  const accumulatedSeconds = Number(order.waitingAccumulatedSeconds ?? 0);
  const startedAtValue = order.waitingStartedAt ? new Date(order.waitingStartedAt) : null;

  let totalSeconds = accumulatedSeconds;
  if (startedAtValue && !Number.isNaN(startedAtValue.getTime())) {
    totalSeconds += Math.max(0, Math.floor((now.getTime() - startedAtValue.getTime()) / 1000));
  }

  return {
    waitingAccumulatedSeconds: totalSeconds,
    waitingFee: Math.floor(totalSeconds / 60) * WAITING_RATE_PER_MIN,
  };
}

export function getWaitingRatePerMinute() {
  return WAITING_RATE_PER_MIN;
}
