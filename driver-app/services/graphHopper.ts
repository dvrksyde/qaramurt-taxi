/**
 * GraphHopper offline map matching — Android only.
 *
 * The native TripMatchModule.kt handles:
 *   - Downloading the pre-built graph from the server (OkHttp)
 *   - Storing graph files in the app's internal storage
 *   - Loading the graph into memory (GraphHopper)
 *   - Running map matching on GPS points (MapMatching.doWork)
 *
 * JS side only calls initialize() once at startup and matchTripPoints() at trip end.
 */

import { NativeModules, Platform } from "react-native";
import { API_BASE } from "./api";

const { TripMatch } = NativeModules;

let initialized = false;
let initializing = false;

/**
 * Download graph (if needed) and load into GraphHopper.
 * Call once at app startup — runs in background, doesn't block UI.
 */
export async function initGraphHopper(): Promise<boolean> {
  if (Platform.OS !== "android" || !TripMatch) return false;
  if (initialized) return true;
  if (initializing) return false;

  initializing = true;
  try {
    // Native module downloads graph from server if not already cached,
    // then loads it from internal storage.
    const ok: boolean = await TripMatch.initialize(`${API_BASE}/api/driver/graph`);
    initialized = ok;
    if (ok) console.log("[GraphHopper] Ready");
    else console.warn("[GraphHopper] Init returned false");
    return ok;
  } catch (e) {
    console.warn("[GraphHopper] Init failed:", e);
    return false;
  } finally {
    initializing = false;
  }
}

/**
 * Match GPS points to the road network.
 * Returns road-network distance in km, or null on any failure.
 * Caller should fall back to Kalman odometer distance when null is returned.
 *
 * Requires >= 10 points for reliable matching (at 1s GPS = 10 seconds minimum).
 */
export async function matchTripPoints(
  points: Array<{ lat: number; lng: number }>,
): Promise<number | null> {
  if (Platform.OS !== "android" || !TripMatch || !initialized) return null;
  if (points.length < 2) return null;

  try {
    const km: number = await TripMatch.matchPoints(points);
    return km > 0 ? km : null;
  } catch (e) {
    console.warn("[GraphHopper] matchPoints failed:", e);
    return null;
  }
}

export function isGraphHopperReady(): boolean {
  return initialized;
}
