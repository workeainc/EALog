import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, type Unsubscribe } from "firebase/firestore";
import { db } from "./firebase";
import type { FinanceAccount, FinanceTransaction } from "../types/tracker";
const accountsRef = (uid: string) => collection(db, "users", uid, "finance_accounts");
const transactionsRef = (uid: string) => collection(db, "users", uid, "finance_transactions");
export const subscribeToFinanceAccounts = (uid: string, cb: (items: FinanceAccount[]) => void): Unsubscribe => onSnapshot(query(accountsRef(uid), orderBy("createdAt", "asc")), snap => cb(snap.docs.map(item => ({ id: item.id, ...item.data() } as FinanceAccount))));
export const subscribeToFinanceTransactions = (uid: string, cb: (items: FinanceTransaction[]) => void): Unsubscribe => onSnapshot(query(transactionsRef(uid), orderBy("date", "desc")), snap => cb(snap.docs.map(item => ({ id: item.id, ...item.data() } as FinanceTransaction))));
export const createFinanceAccount = (uid: string, input: Omit<FinanceAccount, "id" | "createdAt">) => setDoc(doc(accountsRef(uid)), { ...input, createdAt: serverTimestamp() });
export const createFinanceTransaction = (uid: string, input: Omit<FinanceTransaction, "id" | "createdAt">) => { if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Amount must be greater than zero."); if (input.type === "transfer" && (!input.toAccountId || input.toAccountId === input.accountId)) throw new Error("Choose a different destination account."); return setDoc(doc(transactionsRef(uid)), { ...input, createdAt: serverTimestamp() }); };
