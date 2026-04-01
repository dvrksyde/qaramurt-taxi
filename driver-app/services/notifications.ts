import * as Notifications from "expo-notifications";
import * as Device from "expo-constants";
import { Platform } from "react-native";

// Configure how notifications are shown when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Request notification permissions and get the push token */
export async function registerForPushNotifications(): Promise<string | null> {
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

  try {
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    console.log("[Push] Token:", token);
    return token;
  } catch (err) {
    console.log("[Push] Error getting token:", err);
    return null;
  }
}

/** Show a local notification (used for new order alerts) */
export async function showOrderNotification(pickupAddress: string, pricePerKm: number) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "🚖 Новый заказ!",
      body: `📍 ${pickupAddress || "Адрес не указан"} · ${pricePerKm} ₸/км`,
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: null, // Immediately
  });
}
