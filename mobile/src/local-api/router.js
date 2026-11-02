import {HttpError, notFound} from './http.js';

/** Roteador minimo no estilo do Spring: "GET /expenses/:id". O handler recebe {params, query, body}. */
export class Router {
    constructor() {
        this.routes = [];
    }

    add(method, pattern, handler) {
        const names = [];
        const regex = new RegExp('^' + pattern.replace(/:([A-Za-z]+)/g, (_, name) => {
            names.push(name);
            return '([^/]+)';
        }) + '/?$');
        this.routes.push({method, regex, names, handler});
        return this;
    }

    get(pattern, handler) { return this.add('GET', pattern, handler); }
    post(pattern, handler) { return this.add('POST', pattern, handler); }
    put(pattern, handler) { return this.add('PUT', pattern, handler); }
    delete(pattern, handler) { return this.add('DELETE', pattern, handler); }

    /** Devolve {status, body} (body null = sem conteudo) ou lanca HttpError. */
    handle(method, rawUrl, body) {
        const url = new URL(rawUrl, 'http://local');
        const path = url.pathname;
        let pathMatched = false;
        for (const route of this.routes) {
            const match = route.regex.exec(path);
            if (!match) continue;
            pathMatched = true;
            if (route.method !== method) continue;
            const params = {};
            route.names.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
            const query = Object.fromEntries(url.searchParams.entries());
            const result = route.handler({params, query, body});
            if (result && typeof result === 'object' && 'status' in result && ('body' in result || 'text' in result || 'bytes' in result)) return result;
            return result === undefined || result === null ? {status: 204, body: null} : {status: 200, body: result};
        }
        if (pathMatched) throw new HttpError(405, 'Método não permitido.');
        throw notFound(`Não encontrado: ${path}`);
    }
}

export const created = body => ({status: 201, body});
export const noContent = () => ({status: 204, body: null});
