/** Reads and writes the back-arrow state (src/lib/profile-nav.ts) in sessionStorage. Browser only; every call is safe where storage is blocked or unavailable. */
import type { NavState } from "./profile-nav";

const KEY = "wfp.nav";

export function loadNav(): NavState {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as NavState) : {};
  } catch {
    return {};
  }
}

export function saveNav(state: NavState) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the arrow then falls back to the directory */
  }
}
