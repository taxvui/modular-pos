export const isUnresolved = record => !['ACKNOWLEDGED', 'CANCELLED'].includes(record.status);
const DATABASE = 'modular-pos-offline-v1';
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('LOCAL_STORAGE_UNAVAILABLE'));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('LOCAL_STORAGE_UNAVAILABLE'));
    request.onblocked = () => reject(new Error('LOCAL_STORAGE_BLOCKED'));
  });
}
export class OfflineStore {
  constructor({ url, userId, organizationId, storeId }) {
    if (![url, userId, organizationId, storeId].every(Boolean)) throw new Error('OFFLINE_SCOPE_REQUIRED');
    this.scope = JSON.stringify([url, userId, organizationId, storeId]);
  }
  async transact(mode, action) {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('records', mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(new Error('LOCAL_WRITE_FAILED'));
        action(tx.objectStore('records'), value => { result = value; }, tx);
      });
    } finally { db.close(); }
  }
  async enqueue(payload, id = crypto.randomUUID(), display = {}, { finishSave = false } = {}) {
    if (!payload || typeof payload !== 'object') throw new Error('INVALID_LOCAL_REQUEST');
    const record = { id: this.scope + ':sale:' + id, scope: this.scope, operationId: id,
      kind: 'sale', payload: structuredClone(payload), display: structuredClone(display), status: 'PENDING', createdAt: Date.now(), attempts: 0 };
    return this.transact('readwrite', (store, done, tx) => {
      const request = store.get(record.id);
      request.onsuccess = () => {
        if (request.result) {
          if (JSON.stringify(request.result.payload) !== JSON.stringify(record.payload)) { tx.abort(); return; }
          done(request.result);
        } else { store.add(record); done(record); }
        if (finishSave) {
          const pending = store.get(this.scope + ':order-save');
          pending.onsuccess = () => { if (pending.result?.operationId === id) store.delete(pending.result.id); };
        }
      };
    });
  }
  async pendingSave() {
    return this.transact('readonly', (store, done) => {
      const request = store.get(this.scope + ':order-save');
      request.onsuccess = () => done(request.result || null);
    });
  }
  async beginSave(payload, operationId, display = {}) {
    const record = { id: this.scope + ':order-save', scope: this.scope, kind: 'order-save',
      operationId, payload: structuredClone(payload), display: structuredClone(display), createdAt: Date.now() };
    const saved = await this.transact('readwrite', (store, done) => {
      const request = store.get(record.id);
      request.onsuccess = () => {
        if (request.result) done(request.result);
        else { store.add(record); done(record); }
      };
    });
    if (saved.operationId !== operationId || JSON.stringify(saved.payload) !== JSON.stringify(payload)) throw new Error('SAVE_RECOVERY_REQUIRED');
    return saved;
  }
  async finishSave(operationId) {
    return this.transact('readwrite', (store, done) => {
      const request = store.get(this.scope + ':order-save');
      request.onsuccess = () => {
        if (request.result?.operationId === operationId) { store.delete(request.result.id); done(true); }
        else done(false);
      };
    });
  }
  async list() {
    return this.transact('readonly', (store, done) => {
      const request = store.getAll();
      request.onsuccess = () => done(request.result.filter(r => r.scope === this.scope && r.kind === 'sale').sort((a,b) => a.createdAt-b.createdAt));
    });
  }
  async cache(value) {
    return this.transact('readwrite', store => store.put({ id: this.scope + ':catalog', scope: this.scope, kind: 'catalog', value, updatedAt: Date.now() }));
  }
  async cached() {
    return this.transact('readonly', (store, done) => {
      const request = store.get(this.scope + ':catalog');
      request.onsuccess = () => done(request.result?.value ?? null);
    });
  }
  async update(record, patch) {
    return this.transact('readwrite', (store, done) => {
      const request = store.get(record.id);
      request.onsuccess = () => {
        const current = request.result;
        if (!current || current.scope !== this.scope || !isUnresolved(current)) return;
        const next = { ...current, ...patch, attempts: current.attempts + 1 };
        store.put(next); done(next);
      };
    });
  }
  async acceptResult(record, result) {
    if (result?.operation_id !== record.operationId) throw new Error('INVALID_SERVER_ACK');
    let status = 'ACKNOWLEDGED';
    if (result.status === 'CANCELLED') {
      const refund = record.payload.p_received_amount == null ? 0 : record.payload.p_expected_total;
      if (!result.review_id || typeof result.reason !== 'string' || result.reason.trim().length < 3 ||
          Number(result.cash_refund_amount) !== refund) throw new Error('INVALID_SERVER_ACK');
      status = 'CANCELLED';
    } else if (!result.order_id) throw new Error('INVALID_SERVER_ACK');
    return this.update(record, { status, result, error: null });
  }
  async flush(send, { retryConflicts = false } = {}) {
    const work = async () => {
      for (const record of await this.list()) {
        if (!isUnresolved(record) || (record.status === 'CONFLICT' && !retryConflicts)) continue;
        try {
          const result = await send(record.payload, record.operationId);
          await this.acceptResult(record, result);
        } catch (error) {
          const code = error.message || 'NETWORK_ERROR';
          const transient = error instanceof TypeError || error.status >= 500 || error.status === 429 || error.status === 401 || /^(HTTP_5|HTTP_429|AUTH_REQUIRED|INVALID_SERVER_ACK|NETWORK_ERROR)/.test(code);
          await this.update(record, { status: transient ? 'PENDING' : 'CONFLICT', error: code });
          if (transient) break;
        }
      }
      return this.list();
    };
    return globalThis.navigator?.locks ? navigator.locks.request('pos-outbox:' + this.scope, work) : work();
  }
}
