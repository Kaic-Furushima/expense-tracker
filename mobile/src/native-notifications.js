import {Capacitor} from '@capacitor/core';
import {LocalNotifications} from '@capacitor/local-notifications';
import {addDays} from './local-api/reminders.js';
import {isoDate} from './local-api/util.js';
import {notificationId, planNotifications} from './notification-plan.js';

// Avisos no Android. As contas a pagar e o fim do mes sao AGENDADOS (o celular avisa mesmo com o app fechado, as 9h);
// o que depende dos numeros do momento (conta vencida, orcamento perto do limite) aparece quando o app abre.
// Tudo e recalculado a cada alteracao, ao abrir e ao voltar para o app, e o que ja foi agendado e substituido.

const CHANNEL = 'reminders';
const LOOKAHEAD_DAYS = 45;
const SHOWN_KEY = 'native-notified';
const ASKED_KEY = 'native-notify-asked';
const REFRESH_DELAY_MS = 3000;

const store = {
    get: key => { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* sem armazenamento: so avisa de novo */ } }
};

export function installNativeNotifications(getApi) {
    if (!Capacitor.isNativePlatform()) return null;
    // o perfil em uso pode mudar: os servicos sao lidos a cada vez
    const services = () => getApi().services;
    const shownKey = () => `${SHOWN_KEY}:${window.expenseTrackerLocal?.profiles?.current ?? 'main'}`;
    let timer = null;

    const granted = async () => (await LocalNotifications.checkPermissions()).display === 'granted';

    async function schedule() {
        const {settings, upcoming, messages} = services();
        const pending = (await LocalNotifications.getPending()).notifications;
        if (pending.length) await LocalNotifications.cancel({notifications: pending});
        if (!settings.remindersEnabled()) return;
        const now = new Date();
        const today = isoDate(now);
        const {items} = upcoming.compute(today, addDays(today, LOOKAHEAD_DAYS), null);
        const plan = planNotifications({items, today, now, reminderDays: settings.reminderDays(), messages});
        if (!plan.length) return;
        await LocalNotifications.schedule({
            notifications: plan.map(p => ({id: p.id, title: p.title, body: p.body, channelId: CHANNEL, isExactNotification: false, schedule: {at: p.at, allowWhileIdle: true}}))
        });
    }

    /** Mostra agora, uma vez so, o que ja venceu ou estourou o orcamento (o resto e agendado). */
    async function notifyNow() {
        const {settings, reminders, messages} = services();
        if (!settings.remindersEnabled()) return;
        let shown = [];
        try { shown = JSON.parse(store.get(shownKey()) || '[]'); } catch (e) { shown = []; }
        const fresh = reminders.current(() => new Date()).filter(r => (r.kind === 'OVERDUE' || r.kind === 'BUDGET') && !shown.includes(r.key));
        if (!fresh.length) return;
        const list = fresh.length <= 3
            ? fresh.map(r => ({title: r.title, body: r.detail, key: r.key}))
            : [{title: messages.t('Pocketful: {0} lembretes', fresh.length), key: `summary:${fresh[0].key}`,
                body: `${fresh.slice(0, 3).map(r => r.title).join('\n')}\n${messages.t('…abra o app para ver todos.')}`}];
        await LocalNotifications.schedule({
            notifications: list.map(n => ({id: notificationId(`now:${n.key}`), title: n.title, body: n.body, channelId: CHANNEL, isExactNotification: false,
                schedule: {at: new Date(Date.now() + 1000)}}))
        });
        store.set(shownKey(), JSON.stringify([...shown, ...fresh.map(r => r.key)].slice(-200)));
    }

    async function refresh() {
        try {
            if (!(await granted())) return;
            await schedule();
            await notifyNow();
        } catch (e) {
            console.error('Não foi possível atualizar os avisos', e);
        }
    }

    const api2 = {
        status: async () => (await LocalNotifications.checkPermissions()).display,
        async requestPermission() {
            const result = await LocalNotifications.requestPermissions();
            if (result.display === 'granted') await refresh();
            return result.display;
        },
        refresh,
        /** Depois de uma alteracao: espera as seguintes terminarem para recalcular uma vez so. */
        refreshSoon() {
            clearTimeout(timer);
            timer = setTimeout(refresh, REFRESH_DELAY_MS);
        }
    };

    (async () => {
        try {
            await LocalNotifications.createChannel({id: CHANNEL, name: 'Lembretes', description: 'Contas a vencer, orçamentos e fim do mês', importance: 4});
            // Na primeira vez pede a permissao (no Android 13 ou mais ela e obrigatoria); depois so pelo botao dos lembretes.
            if (store.get(ASKED_KEY) !== '1' && (await api2.status()) !== 'granted') {
                store.set(ASKED_KEY, '1');
                await api2.requestPermission();
            }
        } catch (e) {
            console.error('Não foi possível preparar as notificações', e);
        }
        refresh();
    })();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

    window.nativeNotifications = api2;
    return api2;
}
