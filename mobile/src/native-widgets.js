import {App} from '@capacitor/app';
import {Capacitor, registerPlugin} from '@capacitor/core';
import {buildSnapshot} from './widget-snapshot.js';

// Widgets da tela inicial do Android (so no aplicativo). O widget e nativo e nao enxerga o banco: aqui o app monta o
// resumo (ver widget-snapshot.js) e o entrega ao plugin "Widgets", que o guarda e redesenha os widgets.
// - Com senha no app, os widgets ficam desativados (so um aviso) a menos que a pessoa ligue "mostrar mesmo com senha".
// - O botao "+" do widget abre o app em expensetracker://widget/new: depois da senha (se houver), abre "Novo lancamento".

/** O app esta no tema escuro agora? (escolha da pessoa; em automatico, o do aparelho) */
function isDark() {
    const theme = document.documentElement.dataset.theme;
    if (theme) return theme === 'dark';
    try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
}

const Widgets = registerPlugin('Widgets');
const WITH_PASSWORD_KEY = 'widgets-with-password';
const ACTION_KEY = 'widget-action';
const LAUNCH_SEEN_KEY = 'widget-launch-seen';
const NEW_URL = 'expensetracker://widget/new';
const REFRESH_DELAY_MS = 1500;
const ACTION_MAX_AGE_MS = 2 * 60 * 1000;
const ACTION_DELAY_MS = 700;

const local = {
    get: key => { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* sem armazenamento: usa o padrao */ } }
};
const session = {
    get: key => { try { return sessionStorage.getItem(key); } catch (e) { return null; } },
    set: (key, value) => { try { sessionStorage.setItem(key, value); } catch (e) { /* sem armazenamento: a acao se perde */ } },
    remove: key => { try { sessionStorage.removeItem(key); } catch (e) { /* idem */ } }
};

/** Padrao: DESLIGADO (com senha, os widgets nao mostram nada). */
const withPassword = () => local.get(WITH_PASSWORD_KEY) === '1';

export function installNativeWidgets({getApi, access}) {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Widgets')) return null;
    let timer = null;

    async function refresh() {
        try {
            const api = getApi();
            const snapshot = buildSnapshot({
                api, messages: api.services.messages, passwordSet: access.passwordSet(), withPassword: withPassword(), dark: isDark()
            });
            await Widgets.update({json: JSON.stringify(snapshot)});
        } catch (e) {
            console.error('Não foi possível atualizar os widgets', e);
        }
    }

    /** Guarda o pedido do widget para depois da senha: sobrevive a recarregar a pagina (o app tranca depois de um tempo em segundo plano). */
    function remember(url) {
        if (url !== NEW_URL) return false;
        session.set(ACTION_KEY, `new|${Date.now()}`);
        return true;
    }

    const api = {
        withPassword,
        passwordSet: () => access.passwordSet(),
        setWithPassword(on) {
            local.set(WITH_PASSWORD_KEY, on ? '1' : '0');
            return refresh();
        },
        refresh,
        /** O pedido guardado pelo widget ("new"), se ainda valer; consome. O front-end so chama com o app aberto e destrancado. */
        takeAction() {
            const raw = session.get(ACTION_KEY);
            session.remove(ACTION_KEY);
            const [action, at] = String(raw ?? '').split('|');
            return action && Date.now() - Number(at) < ACTION_MAX_AGE_MS ? action : null;
        },
        /** Depois de uma alteracao: espera as seguintes terminarem e atualiza uma vez so. */
        refreshSoon() {
            clearTimeout(timer);
            timer = setTimeout(() => { timer = null; refresh(); }, REFRESH_DELAY_MS);
        }
    };

    App.addListener('appUrlOpen', ({url}) => {
        // espera um pouco: se o app estava trancado por tempo em segundo plano, a pagina recarrega e o pedido segue pela senha
        if (remember(url)) setTimeout(() => window.consumeWidgetAction?.(), ACTION_DELAY_MS);
    });
    // app aberto pelo widget (processo novo): o endereco de abertura vale uma vez so por processo
    App.getLaunchUrl().then(launch => {
        if (launch?.url && session.get(LAUNCH_SEEN_KEY) !== launch.url) {
            session.set(LAUNCH_SEEN_KEY, launch.url);
            remember(launch.url);
        }
    }).catch(() => {});

    refresh();
    // trocou o tema do app: os widgets acompanham
    try { new MutationObserver(() => api.refreshSoon()).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']}); } catch (e) { /* sem observador: atualiza na proxima abertura */ }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refresh();
        else if (timer != null) { // indo para segundo plano com uma atualizacao pendente: manda agora, o timer pode nao rodar
            clearTimeout(timer);
            timer = null;
            refresh();
        }
    });
    window.nativeWidgets = api;
    return api;
}
