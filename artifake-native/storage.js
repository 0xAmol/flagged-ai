// storage.js — tiny async storage shim (no extra dependency needed for v1;
// swap for @react-native-async-storage/async-storage if you want persistence
// hardened across OS cleanups).
import { Platform } from "react-native";
let mem = {};
const AsyncStorageShim = {
  async get(k) {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") return localStorage.getItem(k);
    return mem[k] ?? null;
  },
  async set(k, v) {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") { localStorage.setItem(k, v); return; }
    mem[k] = v;
  },
};
export default AsyncStorageShim;
