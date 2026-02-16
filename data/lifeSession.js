import * as FileSystem from "expo-file-system/legacy";

const SESSION_FILE = `${FileSystem.documentDirectory}life-session.json`;

export async function loadLifeSession() {
  try {
    const info = await FileSystem.getInfoAsync(SESSION_FILE);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(SESSION_FILE);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveLifeSession(session) {
  try {
    await FileSystem.writeAsStringAsync(SESSION_FILE, JSON.stringify(session));
  } catch {
    // Ignore persistence errors to avoid blocking gameplay.
  }
}
