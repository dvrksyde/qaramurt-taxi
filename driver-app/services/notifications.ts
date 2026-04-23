import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const orderNotificationIds = new Map<number, string>();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("orders", {
        name: "Новые заказы",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 200, 500],
        sound: "default",
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("[Push] Permission not granted");
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    console.log("[Push] Token:", token);
    return token;
  } catch (err) {
    console.log("[Push] Error:", err);
    return null;
  }
}

async function clearNotificationById(notificationId: string) {
  await Promise.allSettled([
    Notifications.dismissNotificationAsync(notificationId),
    Notifications.cancelScheduledNotificationAsync(notificationId),
  ]);
}

export async function dismissOrderNotification(orderId: number) {
  const notificationId = orderNotificationIds.get(orderId);
  if (!notificationId) return;

  await clearNotificationById(notificationId);
  orderNotificationIds.delete(orderId);
}

export async function dismissAllOrderNotifications() {
  const ids = Array.from(orderNotificationIds.values());
  if (ids.length === 0) return;

  await Promise.allSettled(ids.map((notificationId) => clearNotificationById(notificationId)));
  orderNotificationIds.clear();
}

export async function showOrderNotification(orderId: number, pickupAddress: string, pricePerKm: number) {
  try {
    await dismissOrderNotification(orderId);

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Новый заказ!",
        body: `📍 ${pickupAddress || "Адрес не указан"} · ${pricePerKm} ₸/км`,
        sound: "default",
        data: {
          type: "order_alert",
          orderId,
        },
      },
      trigger: null,
    });

    orderNotificationIds.set(orderId, notificationId);
  } catch (err) {
    console.log("[Push] Error showing notification:", err);
  }
}
