import {HttpError} from './local-api/http.js';

// Restaurar um backup escolhendo ONDE: sobre um perfil existente (qualquer um, nao so o em uso) ou num perfil novo.
// Sobrescrever um perfil, com o sync ligado, tambem sobrescreve a nuvem e os outros aparelhos (forca a nuvem a ficar igual
// ao backup). Mesmas rotas do back-end Java (BackupController): POST /backups/restore e POST /backups/:nome/restore, com
// {profileId?, newProfileName?, backupFirst?} no corpo.

export function createRestoreHttp({profiles, sync, backupsFor}) {
    async function restoreInto(content, r = {}) {
        const isNew = !!String(r.newProfileName ?? '').trim();
        let target;
        if (isNew) target = (await profiles.createQuiet(r.newProfileName)).id;
        else {
            target = r.profileId || profiles.current;
            if (!profiles.exists(target)) throw new HttpError(404, 'Perfil não encontrado.');
        }
        try {
            if (!isNew && r.backupFirst === true) await profiles.withRuntime(target, rt => backupsFor(target, rt).create());
            await profiles.withRuntime(target, rt => backupsFor(target, rt).restoreContent(content));
        } catch (e) {
            if (isNew) { // o perfil criado so para esta restauracao nao fica
                await profiles.remove(target);
                await profiles.purge(target);
            }
            throw e;
        }
        let syncError = null;
        if (!isNew && sync.connected()) {
            try { await sync.forceOverwrite(target); } catch (e) { syncError = e.message; }
        }
        return {status: 200, body: {profileId: target, created: isNew, syncError}};
    }

    return {
        /** Devolve {status, body} ou null se a rota nao for de restauracao. */
        async handle(method, path, body) {
            if (method !== 'POST') return null;
            if (path === '/backups/restore') {
                if (typeof body?.content !== 'string' || !body.content.trim()) throw new HttpError(400, 'Dados inválidos.', {content: 'O arquivo está vazio.'});
                return restoreInto(body.content, body);
            }
            const m = /^\/backups\/([^/]+)\/restore$/.exec(path);
            if (!m) return null;
            const content = await backupsFor(profiles.current, profiles.runtime).read(decodeURIComponent(m[1]));
            return restoreInto(content, body ?? {});
        },
        restoreInto
    };
}
