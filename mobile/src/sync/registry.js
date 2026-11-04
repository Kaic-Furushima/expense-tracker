// Mantem a lista de perfis igual em todos os aparelhos (o computador faz o mesmo, em ProfileRegistrySync.java): um perfil
// criado em um aparelho aparece nos outros, renomear e mandar para a lixeira vao junto, e um perfil excluido de vez some de
// todos. Usa o "perfil" _registry do hub, com uma linha por perfil (a identidade de sync dele) que leva o nome e quando foi
// para a lixeira, cifrados como todo o resto. Vale a alteracao mais recente. Os dados de cada perfil sincronizam a parte.

export const HUB_PROFILE = '_registry';
const TABLE = 'profiles';
const PAGE = 200;

export class ProfileRegistrySync {
    /**
     * @param state {get cursor, set cursor}: onde este aparelho parou de ler o registro
     */
    constructor({hub, crypto, profiles, state, deviceId, log = console}) {
        this.hub = hub;
        this.crypto = crypto;
        this.profiles = profiles;
        this.state = state;
        this.deviceId = deviceId;
        this.log = log;
    }

    async sync() {
        await this.pull();
        await this.push();
    }

    async pull() {
        let cursor = this.state.cursor;
        for (;;) {
            const page = await this.hub.pull(HUB_PROFILE, cursor, PAGE);
            for (const c of page) {
                if (c.deviceId === this.deviceId || c.table !== TABLE) continue;
                try {
                    await this.apply(c);
                } catch (e) {
                    this.log.warn?.(`Não foi possível aplicar o perfil ${c.uuid} vindo do sync`, e);
                }
            }
            if (page.length) cursor = page[page.length - 1].seq;
            if (page.length < PAGE) break;
        }
        this.state.cursor = cursor;
    }

    async apply(c) {
        const id = this.profiles.idOfSync(c.uuid);
        if (c.deleted) { // excluido de vez em outro aparelho
            if (id && id !== 'main') await this.profiles.purgeFromRemote(id);
            return;
        }
        const payload = JSON.parse(await this.crypto.decrypt(c.payload));
        const trashedAt = payload.trashedAt ?? null;
        if (!id) {
            const purgedHere = this.profiles.purged().some(p => p.syncId === c.uuid && p.at >= c.updatedAt);
            if (!purgedHere) await this.profiles.createFromRemote(c.uuid, payload.name, trashedAt, c.updatedAt);
            return;
        }
        const mine = this.profiles.registry().find(r => r.id === id);
        if (c.updatedAt > mine.updatedAt) await this.profiles.updateFromRemote(id, payload.name, id === 'main' ? null : trashedAt, c.updatedAt);
    }

    async push() {
        const changes = [];
        const sent = [];
        for (const e of this.profiles.registry()) {
            if (e.updatedAt <= this.profiles.registrySentAt(e.id)) continue; // nada de novo
            if (e.id === 'main' && e.updatedAt === 0) continue; // o principal comeca em 0
            changes.push({table: TABLE, uuid: e.syncId, updatedAt: e.updatedAt, deleted: false,
                payload: await this.crypto.encrypt(JSON.stringify({name: e.name, trashedAt: e.trashedAt}))});
            sent.push(e);
        }
        const purged = this.profiles.purged();
        for (const p of purged) changes.push({table: TABLE, uuid: p.syncId, updatedAt: p.at, deleted: true, payload: null});
        if (!changes.length) return;
        await this.hub.push(HUB_PROFILE, this.deviceId, changes);
        for (const e of sent) await this.profiles.markRegistrySent(e.id, e.updatedAt);
        for (const p of purged) await this.profiles.forgetPurged(p.syncId);
    }
}
