// ClaimCheck — Firestore-backed receipt store (browser, live mode only).
// Receipts live in a single `receipts` collection, ordered by createdAt.
// The document id is the receipt id, so the ledger is addressable and the
// verify view can link straight to a receipt.

import { getFirestore, collection, doc, setDoc, getDocs, query, orderBy } from 'firebase/firestore';

export class FirestoreStore {
  constructor(app) {
    this.db = getFirestore(app);
    this.col = collection(this.db, 'receipts');
  }

  async list() {
    const snap = await getDocs(query(this.col, orderBy('createdAt', 'asc')));
    return snap.docs.map((d) => d.data());
  }

  async last() {
    const items = await this.list();
    return items.length ? items[items.length - 1] : null;
  }

  async append(receipt) {
    await setDoc(doc(this.col, receipt.id), receipt);
    return receipt;
  }
}
