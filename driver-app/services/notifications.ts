import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

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

export async function showOrderNotification(pickupAddress: string, pricePerKm: number) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Новый заказ!",
        body: `📍 ${pickupAddress || "Адрес не указан"} · ${pricePerKm} ₸/км`,
        sound: "default",
      },
      trigger: null,
    });
  } catch (err) {
    console.log("[Push] Error showing notification:", err);
  }
}
