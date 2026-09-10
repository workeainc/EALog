import { doc, onSnapshot, serverTimestamp, setDoc, type Unsubscribe } from "firebase/firestore";
import { db } from "./firebase";
import type { AppMode, AppModeState } from "../types/tracker";

const modeRef = (uid: string) => doc(db, "users", uid, "settings", "app_mode");
export const WORKDAY_MODE: AppModeState = { mode: "workday" };

const asMode = (value: any): AppModeState => ({
  mode: ["workday", "break", "vacation"].includes(value?.mode) ? value.mode as AppMode : "workday",
  breakStartedAt: typeof value?.breakStartedAt === "string" ? value.breakStartedAt : undefined,
  breakExpectedEndAt: typeof value?.breakExpectedEndAt === "string" ? value.breakExpectedEndAt : null,
  breakReason: typeof value?.breakReason === "string" ? value.breakReason : undefined,
  vacationStartDate: typeof value?.vacationStartDate === "string" ? value.vacationStartDate : undefined,
  vacationEndDate: typeof value?.vacationEndDate === "string" ? value.vacationEndDate : undefined,
  vacationReason: typeof value?.vacationReason === "string" ? value.vacationReason : undefined,
  relaxedDiscipline: Boolean(value?.relaxedDiscipline),
  updatedAt: value?.updatedAt || null,
});

export const subscribeToAppMode = (uid: string, callback: (mode: AppModeState) => void): Unsubscribe =>
  onSnapshot(modeRef(uid), (snapshot) => callback(snapshot.exists() ? asMode(snapshot.data()) : WORKDAY_MODE));

export const saveAppMode = (uid: string, state: AppModeState) =>
  setDoc(modeRef(uid), { ...state, updatedAt: serverTimestamp() }, { merge: false });

export const effectiveAppMode = (state: AppModeState, today: string, now = Date.now()): AppMode => {
  if (state.mode === "vacation") {
    return state.vacationStartDate && state.vacationEndDate && state.vacationStartDate <= today && today <= state.vacationEndDate
      ? "vacation" : "workday";
  }
  if (state.mode === "break") {
    return !state.breakExpectedEndAt || Date.parse(state.breakExpectedEndAt) > now ? "break" : "workday";
  }
  return "workday";
};
