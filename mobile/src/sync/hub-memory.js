// Hub em memoria: o mesmo comportamento do hub de verdade (static/sync/supabase-hub.sql), para os testes e para quem quiser
// experimentar o sync sem servidor. Uma linha por (perfil, tabela, uuid); cada gravacao aceita ganha um numero de
// sequencia novo; so entra uma versao mais nova (updatedAt maior) que a guardada.

export class MemoryHub {
    constructor() {
        this.vault = null;
        this.rows = new Map();
        this.seq = 0;
        this.failNext = null; // testes: faz a proxima chamada falhar, simulando falta de rede
    }

    async getVault() {
        this.check();
        return this.vault;
    }

    async setVault(vault) {
        this.check();
        if (this.vault) throw new Error('O cofre do sync ja existe.');
        this.vault = {...vault};
    }

    async push(profileId, deviceId, changes) {
        this.check();
        let accepted = 0;
        for (const c of changes) {
            const key = `${profileId}|${c.table}|${c.uuid}`;
            const old = this.rows.get(key);
            if (old && c.updatedAt <= old.updatedAt) continue;
            this.rows.set(key, {
                seq: ++this.seq, profileId, table: c.table, uuid: c.uuid, updatedAt: c.updatedAt,
                deleted: !!c.deleted, payload: c.deleted ? null : c.payload, deviceId
            });
            accepted++;
        }
        return {accepted};
    }

    async pull(profileId, afterSeq, limit) {
        this.check();
        return [...this.rows.values()]
            .filter(r => r.profileId === profileId && r.seq > afterSeq)
            .sort((a, b) => a.seq - b.seq)
            .slice(0, limit)
            .map(({profileId: ignored, ...row}) => ({...row}));
    }

    check() {
        if (this.failNext) {
            const error = this.failNext;
            this.failNext = null;
            throw error;
        }
    }
}
