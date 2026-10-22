export class AuthClient {
  #token = null;
  #refreshToken = null;
  #userId = null;
  #expiresAt = Infinity;
  #epoch = 0;
  #refreshing = null;
  #storage;
  #storageKey;
  constructor({ url, key, fetcher = globalThis.fetch, now = Date.now, onSessionEnd = () => {}, sessionStorage = null }) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('SUPABASE_HTTPS_REQUIRED');
    if (!key || key.includes('your-')) throw new Error('SUPABASE_NOT_CONFIGURED');
    this.url = parsed.href.replace(/\/$/, '');
    this.key = key;
    this.fetcher = fetcher.bind(globalThis);
    this.now = now;
    this.onSessionEnd = onSessionEnd;
    this.#storage = sessionStorage;
    this.#storageKey = `modular-pos-session:${this.url}`;
  }
  get userId() { return this.#userId; }
  get signedIn() { return this.#token !== null; }
  #authError(code = 'AUTH_REQUIRED') { const error = new Error(code); error.status = 401; return error; }
  #checkEpoch(epoch) { if (epoch !== this.#epoch) throw this.#authError('SESSION_CHANGED'); }
  #clear(reason) {
    const hadSession = this.signedIn;
    this.#epoch++;
    this.#token = null; this.#refreshToken = null; this.#userId = null; this.#expiresAt = Infinity;
    this.#store(null);
    if (hadSession) this.onSessionEnd({ reason });
  }
  #save(result) {
    this.#token = result.access_token;
    this.#refreshToken = result.refresh_token || null;
    this.#userId = result.user.id;
    this.#expiresAt = Number.isFinite(result.expires_at) ? result.expires_at * 1000 :
      Number.isFinite(result.expires_in) && result.expires_in > 0 ? this.now() + result.expires_in * 1000 : Infinity;
    // Keep only the refresh credential across navigation in this tab, never passwords.
    this.#store(this.#refreshToken ? { refresh_token: this.#refreshToken, user_id: this.#userId } : null);
  }
  #store(value) {
    try {
      if (value) this.#storage?.setItem(this.#storageKey, JSON.stringify(value));
      else this.#storage?.removeItem(this.#storageKey);
    } catch { /* Disabled storage leaves the in-memory session available. */ }
  }
  async restoreSession() {
    const epoch = this.#epoch;
    let saved;
    try { saved = JSON.parse(this.#storage?.getItem(this.#storageKey) || 'null'); }
    catch { this.#store(null); return null; }
    if (!saved) return null;
    if (typeof saved.refresh_token !== 'string' || !saved.refresh_token || typeof saved.user_id !== 'string' || !saved.user_id) {
      this.#store(null); return null;
    }
    try {
      const response = await this.#send('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({ refresh_token: saved.refresh_token }),
      });
      this.#checkEpoch(epoch);
      const result = await this.#read(response);
      this.#checkEpoch(epoch);
      if (!result?.access_token || !result.refresh_token || result.user?.id !== saved.user_id) throw this.#authError();
      this.#save(result);
      return { id: result.user.id, email: result.user.email };
    } catch (error) {
      if (epoch === this.#epoch && (error.status === 400 || error.status === 401 || error.status === 403)) this.#store(null);
      throw error;
    }
  }
  #send(path, { method = 'GET', body } = {}, token = null) {
    return this.fetcher(`${this.url}${path}`, {
      method, cache: 'no-store',
      headers: { apikey: this.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body }),
    });
  }
  async #read(response) {
    let data = null;
    if (response.status !== 204) {
      try { data = await response.json(); }
      catch (cause) {
        if (cause instanceof TypeError) throw cause;
        const error = new Error(response.ok ? 'INVALID_JSON_RESPONSE' : `HTTP_${response.status}`);
        error.status = response.status;
        throw error;
      }
    }
    if (!response.ok) {
      const businessCode = typeof data?.message === 'string' ? data.message.match(/^([A-Z][A-Z_]+)(?::|$)/)?.[1] : null;
      const error = new Error(data?.error_code || businessCode || data?.code || `HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async refreshSession() {
    if (!this.#token) throw this.#authError();
    const epoch = this.#epoch;
    if (this.#refreshing?.epoch === epoch) return this.#refreshing.promise;
    if (!this.#refreshToken) { this.#clear('EXPIRED'); throw this.#authError(); }
    const refreshToken = this.#refreshToken, userId = this.#userId;
    const entry = { epoch, promise: null };
    entry.promise = (async () => {
      let response;
      try {
        response = await this.#send('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) });
        this.#checkEpoch(epoch);
        // Temporary transport/rate-limit failures retain the in-memory session for retry.
        if (!response.ok && (response.status >= 500 || response.status === 429)) return await this.#read(response);
        if (!response.ok) { this.#clear('EXPIRED'); throw this.#authError(); }
        const result = await this.#read(response);
        this.#checkEpoch(epoch);
        if (!result?.access_token || !result.refresh_token || result.user?.id !== userId) {
          this.#clear('EXPIRED'); throw this.#authError();
        }
        this.#save(result);
      } catch (error) {
        // A successful rotation with an unreadable response cannot be acknowledged safely.
        if (epoch === this.#epoch && response?.ok && error.message === 'INVALID_JSON_RESPONSE') this.#clear('EXPIRED');
        throw error;
      } finally { if (this.#refreshing === entry) this.#refreshing = null; }
    })();
    this.#refreshing = entry;
    return entry.promise;
  }
  async request(path, { method = 'GET', body, authenticated = true } = {}) {
    body = body === undefined ? undefined : JSON.stringify(body);
    if (!authenticated) return this.#read(await this.#send(path, { method, body }));
    if (!this.#token) throw this.#authError();
    const epoch = this.#epoch;
    if (this.#refreshToken && this.#expiresAt <= this.now() + 30000) await this.refreshSession();
    this.#checkEpoch(epoch);
    const token = this.#token;
    let response = await this.#send(path, { method, body }, token);
    this.#checkEpoch(epoch);
    if (response.status === 401 && this.#refreshToken) {
      // Another request may already have replaced the rejected token.
      if (this.#token === token) await this.refreshSession();
      this.#checkEpoch(epoch);
      response = await this.#send(path, { method, body }, this.#token);
      this.#checkEpoch(epoch);
    }
    if (response.status === 401) { this.#clear('EXPIRED'); throw this.#authError(); }
    const data = await this.#read(response);
    this.#checkEpoch(epoch);
    return data;
  }
  async signIn(email, password) {
    this.#clear('REPLACED');
    const epoch = this.#epoch;
    const result = await this.request('/auth/v1/token?grant_type=password', { method: 'POST', authenticated: false, body: { email, password } });
    this.#checkEpoch(epoch);
    if (!result?.access_token || !result.user?.id) throw new Error('INVALID_AUTH_RESPONSE');
    this.#save(result);
    return { id: result.user.id, email: result.user.email };
  }
  signUp(email, password) {
    return this.request('/auth/v1/signup', { method: 'POST', authenticated: false, body: { email, password } });
  }
  async signOut() {
    const token = this.#token;
    this.#clear('SIGNED_OUT');
    if (token) await this.#read(await this.#send('/auth/v1/logout', { method: 'POST' }, token));
  }
  organizations() { return this.request('/rest/v1/organizations?select=id,name,slug&order=name'); }
  stores() { return this.request('/rest/v1/stores?select=id,organization_id,name,code,timezone&order=name'); }
  bootstrap({ name, slug, storeName, address }) {
    return this.request('/rest/v1/rpc/rpc_bootstrap_workspace', { method: 'POST', body: { p_name: name, p_slug: slug, p_store_name: storeName, p_store_address: address } });
  }
}
