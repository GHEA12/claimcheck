// ClaimCheck — receipt store interface.
//
// A store keeps receipts ordered oldest -> newest and exposes the chain
// tip. Three implementations share this shape:
//   MemoryStore       — tests and the scripted demo
//   LocalStorageStore — the browser in demo mode (no Firebase config yet)
//   FirestoreStore    — live mode (src/store-firestore.js, browser only)

export class MemoryStore {
  constructor(seed = []) {
    this.items = [...seed];
  }
  async list() {
    return [...this.items];
  }
  async last() {
    return this.items.length ? this.items[this.items.length - 1] : null;
  }
  async append(receipt) {
    this.items.push(receipt);
    return receipt;
  }
}

export class LocalStorageStore {
  constructor(storage, key = 'claimcheck.receipts.v1') {
    this.storage = storage;
    this.key = key;
  }
  _read() {
    try {
      const raw = this.storage.getItem(this.key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  async list() {
    return this._read();
  }
  async last() {
    const items = this._read();
    return items.length ? items[items.length - 1] : null;
  }
  async append(receipt) {
    const items = this._read();
    items.push(receipt);
    this.storage.setItem(this.key, JSON.stringify(items));
    return receipt;
  }
}
