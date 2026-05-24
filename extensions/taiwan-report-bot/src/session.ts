// Thin re-export layer so the rest of the bot doesn't depend on the storage
// implementation directly. Persistent store lives in services/store.ts.
export {
  clearSession,
  getSession,
  saveSession,
  type PersistedSession,
} from "./services/store.js";
