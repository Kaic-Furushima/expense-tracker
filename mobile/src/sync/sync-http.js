import {badRequest} from '../local-api/http.js';

// Rotas /api/sync do aplicativo (as mesmas do computador): a tela de sincronizacao e uma so para os dois.

export function createSyncHttp(getService) {
    return {
        async handle(method, path, body) {
            if (!path.startsWith('/api/sync')) return null;
            const service = getService();
            const ok = status => ({status: 200, body: status});
            if (method === 'GET' && path === '/api/sync') return ok(service.status());
            try {
                if (method === 'PUT' && path === '/api/sync') return ok(await service.connect(body ?? {}));
                if (method === 'POST' && path === '/api/sync/now') return ok(await service.syncNow());
                if (method === 'PUT' && path === '/api/sync/auto') return ok(await service.setAuto(body?.enabled !== false));
                if (method === 'DELETE' && path === '/api/sync') return ok(await service.disconnect());
            } catch (e) {
                throw badRequest(e.message);
            }
            return {status: 404, body: {status: 404, title: 'Não encontrado', detail: path}};
        }
    };
}
