// Hub no Supabase (Postgres + login por e-mail e senha). O esquema esta em static/sync/supabase-hub.sql, em src/main/resources/static/sync.
// So usa fetch: funciona no celular (WebView), no navegador e no Node.

const JSON_HEADERS = {'Content-Type': 'application/json'};

export class SupabaseHub {
    /**
     * @param url      https://<projeto>.supabase.co
     * @param anonKey  chave "anon" publica do projeto (nao e segredo: quem protege os dados e o login + RLS)
     * @param session  {access_token, refresh_token, expires_at} guardado pelo chamador entre aberturas do app
     * @param onSession chamado quando a sessao muda (para guardar)
     */
    constructor({url, anonKey, session = null, onSession = () => {}, fetchImpl = (...a) => fetch(...a), now = () => Date.now()}) {
        this.url = url.replace(/\/+$/, '');
        this.anonKey = anonKey;
        this.session = session;
        this.onSession = onSession;
        this.fetch = fetchImpl;
        this.now = now;
    }

    async signIn(email, password) {
        return this.token('password', {email, password});
    }

    async signUp(email, password) {
        const res = await this.fetch(`${this.url}/auth/v1/signup`, {
            method: 'POST', headers: {...JSON_HEADERS, apikey: this.anonKey}, body: JSON.stringify({email, password})
        });
        const body = await this.readJson(res);
        if (body.access_token) this.setSession(body);
        return body;
    }

    async token(grant, payload) {
        const res = await this.fetch(`${this.url}/auth/v1/token?grant_type=${grant}`, {
            method: 'POST', headers: {...JSON_HEADERS, apikey: this.anonKey}, body: JSON.stringify(payload)
        });
        const body = await this.readJson(res);
        this.setSession(body);
        return body;
    }

    setSession(body) {
        this.session = {
            access_token: body.access_token,
            refresh_token: body.refresh_token,
            expires_at: this.now() + (Number(body.expires_in) || 3600) * 1000
        };
        this.onSession(this.session);
    }

    signedIn() {
        return !!this.session?.refresh_token;
    }

    async bearer() {
        if (!this.signedIn()) throw new Error('Entre na conta do sync.');
        if (this.session.expires_at - this.now() < 60000) await this.token('refresh_token', {refresh_token: this.session.refresh_token});
        return this.session.access_token;
    }

    async request(path, {method = 'GET', body, headers = {}} = {}) {
        const res = await this.fetch(`${this.url}/rest/v1/${path}`, {
            method,
            headers: {...JSON_HEADERS, apikey: this.anonKey, Authorization: `Bearer ${await this.bearer()}`, ...headers},
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return this.readJson(res);
    }

    async readJson(res) {
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { /* resposta sem corpo JSON */ }
        if (!res.ok) throw new Error(data?.error_description ?? data?.msg ?? data?.message ?? `Servidor de sync respondeu ${res.status}.`);
        return data;
    }

    async getVault() {
        const rows = await this.request('vault?select=salt,check_value');
        return rows?.[0] ? {salt: rows[0].salt, check: rows[0].check_value} : null;
    }

    async setVault({salt, check}) {
        await this.request('vault', {method: 'POST', body: {salt, check_value: check}, headers: {Prefer: 'return=minimal'}});
    }

    async push(profileId, deviceId, changes) {
        const accepted = await this.request('rpc/push_changes', {
            method: 'POST',
            body: {
                p_profile: profileId, p_device: deviceId,
                p_changes: changes.map(c => ({
                    table_name: c.table, row_uuid: c.uuid, updated_at: c.updatedAt, deleted: !!c.deleted, payload: c.payload ?? null
                }))
            }
        });
        return {accepted: Number(accepted) || 0};
    }

    async pull(profileId, afterSeq, limit) {
        const query = `changes?select=seq,table_name,row_uuid,updated_at,deleted,payload,device_id`
            + `&profile_id=eq.${encodeURIComponent(profileId)}&seq=gt.${Number(afterSeq)}&order=seq.asc&limit=${Number(limit)}`;
        const rows = await this.request(query);
        return rows.map(r => ({
            seq: Number(r.seq), table: r.table_name, uuid: r.row_uuid, updatedAt: Number(r.updated_at),
            deleted: !!r.deleted, payload: r.payload, deviceId: r.device_id
        }));
    }
}
