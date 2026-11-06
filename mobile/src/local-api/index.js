import {Backup} from './backup.js';
import {Budgets} from './budgets.js';
import {Catalog} from './catalog.js';
import {Db} from './db.js';
import {Demo} from './demo.js';
import {Expenses} from './expenses.js';
import {exportCsv} from './export.js';
import {HttpError} from './http.js';
import {Attachments} from './attachments.js';
import {Importer} from './import.js';
import {Messages} from './messages.js';
import {Pots} from './pots.js';
import {Recurring} from './recurring.js';
import {Reminders} from './reminders.js';
import {Reports} from './reports.js';
import {Router, created, noContent} from './router.js';
import {seed} from './seed.js';
import {Settings} from './settings.js';
import {Summary} from './summary.js';
import {Invoices} from './invoices.js';
import {Templates} from './templates.js';
import {Transfers} from './transfers.js';
import {Trash} from './trash.js';
import {Upcoming} from './upcoming.js';
import {Wishes} from './wishes.js';
import {isoDate} from './util.js';

const APP_VERSION = '0.1.0-celular';
const NOT_YET = 'Este recurso ainda não está disponível no aplicativo do celular.';

/**
 * Monta a "API local": o mesmo contrato REST do back-end Java, respondido no proprio aparelho com SQLite.
 * Devolve {handle(method, url, body) -> {status, body}, db, services}.
 */
export function createApi(sqlDb, options = {}) {
    const db = new Db(sqlDb, options);
    db.migrate();
    const settings = new Settings(db, options.languageStore ?? null);
    seed(db, settings.language());
    const catalog = new Catalog(db);
    const expenses = new Expenses(db, catalog);
    const budgets = new Budgets(db, catalog);
    const summary = new Summary(db, catalog, budgets, settings);
    const transfers = new Transfers(db, catalog);
    const invoices = new Invoices(db, catalog, expenses, transfers);
    const recurring = new Recurring(db, catalog, expenses, settings);
    const pots = new Pots(db);
    const templates = new Templates(db, catalog);
    const attachments = new Attachments(db);
    const wishes = new Wishes(db, catalog, expenses, pots);
    const upcoming = new Upcoming(db, catalog, invoices, recurring);
    const importer = new Importer(db, catalog, expenses, transfers);
    const demo = new Demo(db, catalog, expenses, transfers, budgets);
    const messages = new Messages(settings);
    const reminders = new Reminders(settings, messages, upcoming, summary);
    const reports = new Reports(db, catalog, settings, messages);
    const backup = new Backup(db);
    const router = new Router();
    const trash = new Trash(db);
    trash.purgeExpired();
    registerRoutes(router, {db, settings, catalog, expenses, transfers, invoices, recurring, pots, wishes, templates, attachments, reminders, importer, demo, trash, budgets, summary, upcoming});

    function handle(method, url, body) {
        try {
            return router.handle(method.toUpperCase(), url, body);
        } catch (e) {
            if (e instanceof HttpError) return {status: e.status, body: problem(e)};
            throw e;
        }
    }
    return {handle, db, services: {settings, catalog, expenses, transfers, invoices, recurring, pots, wishes, templates, attachments, reminders, importer, demo, reports, messages, trash, budgets, summary, upcoming, backup}};
}

/** Corpo de erro no formato "problem detail" do Spring, que o front ja sabe ler (detail / errors). */
function problem(e) {
    const body = {status: e.status, title: e.message, detail: e.message};
    if (e.errors) body.errors = e.errors;
    return body;
}

const notYet = () => { throw new HttpError(501, NOT_YET); };

/** O resumo interno de uma fatura carrega o valor em centavos; a resposta da API nao. */
const publicInvoice = ({remainingCents, ...invoice}) => invoice;

function registerRoutes(r, {db, settings, catalog, expenses, transfers, invoices, recurring, pots, wishes, templates, attachments, reminders, importer, demo, trash, budgets, summary, upcoming}) {
    // categorias
    r.get('/categories', () => catalog.categories());
    r.post('/categories', ({body}) => created(catalog.createCategory(body ?? {})));
    r.post('/categories/:id/copy', ({params}) => created(catalog.copyCategoryToOtherKind(Number(params.id))));
    r.put('/categories/:id', ({params, body}) => catalog.updateCategory(Number(params.id), body ?? {}));
    r.delete('/categories/:id', ({params}) => catalog.deleteCategory(Number(params.id)));

    // formas de pagamento
    r.get('/payment-methods', () => catalog.methods());
    r.post('/payment-methods', ({body}) => created(catalog.createMethod(body ?? {})));
    r.put('/payment-methods/:id', ({params, body}) => catalog.updateMethod(Number(params.id), body ?? {}));
    r.delete('/payment-methods/:id', ({params}) => catalog.deleteMethod(Number(params.id)));

    // contas
    r.get('/accounts', () => catalog.accounts());
    r.post('/accounts', ({body}) => created(catalog.createAccount(body ?? {})));
    r.put('/accounts/:id', ({params, body}) => catalog.updateAccount(Number(params.id), body ?? {}));
    r.delete('/accounts/:id', ({params}) => catalog.deleteAccount(Number(params.id)));
    r.post('/accounts/:id/adjust-balance', ({params, body}) => catalog.adjustBalance(Number(params.id), body ?? {}));

    r.get('/tags', () => catalog.tagNames());

    // lancamentos
    r.get('/expenses', ({query}) => expenses.list(query));
    r.get('/expenses/suggestions', ({query}) => expenses.suggestions(query.q));
    r.post('/expenses/batch', ({body}) => expenses.batch(body ?? {}));
    r.get('/expenses/:id', ({params}) => expenses.get(Number(params.id)));
    r.post('/expenses', ({body}) => created(expenses.create(body ?? {})));
    r.put('/expenses/:id', ({params, body}) => expenses.update(Number(params.id), body ?? {}));
    r.post('/expenses/:id/pay', ({params, body}) => expenses.pay(Number(params.id), body?.date));
    r.delete('/expenses/:id', ({params, query}) => {
        const id = Number(params.id);
        expenses.row(id); // 404 se nao existe
        if (String(query.scope ?? '').toUpperCase() === 'FOLLOWING') return {ids: expenses.trashFollowing(id)};
        expenses.trash(id);
        return noContent();
    });

    // transferencias
    r.get('/transfers', ({query}) => transfers.list(query.month || thisMonth(db), query.accountId ? Number(query.accountId) : null));
    r.post('/transfers', ({body}) => created(transfers.create(body ?? {})));
    r.put('/transfers/:id', ({params, body}) => transfers.update(Number(params.id), body ?? {}));
    r.delete('/transfers/:id', ({params}) => { transfers.trash(Number(params.id)); return noContent(); });

    // pagamentos recorrentes
    r.get('/recurring', () => recurring.rules());
    r.post('/recurring', ({body}) => created(recurring.create(body ?? {})));
    r.get('/recurring/occurrences', ({query}) => recurring.occurrencesOf(query.month || thisMonth(db)));
    r.post('/recurring/occurrences/:id/pay', ({params, body}) => recurring.pay(Number(params.id), body ?? {}));
    r.post('/recurring/occurrences/:id/skip', ({params}) => recurring.skip(Number(params.id)));
    r.post('/recurring/occurrences/:id/reopen', ({params}) => recurring.reopen(Number(params.id)));
    r.put('/recurring/:id', ({params, body}) => recurring.update(Number(params.id), body ?? {}));
    r.delete('/recurring/:id', ({params}) => recurring.delete(Number(params.id)));

    // importacao de extratos (OFX, CSV de banco ou CSV do app)
    r.post('/import/preview', ({body}) => importer.preview(body?.content, body?.accountId ?? null, body?.invertSigns === true));
    r.post('/import/commit', ({body}) => importer.commit(body?.rows, body?.accountId ?? null));

    // modelos (favoritos)
    r.get('/templates', () => templates.list());
    r.post('/templates', ({body}) => created(templates.create(body ?? {})));
    r.delete('/templates/:id', ({params}) => templates.delete(Number(params.id)));

    // anexos (comprovantes)
    r.get('/expenses/:id/attachments', ({params}) => attachments.list(Number(params.id)));
    r.post('/expenses/:id/attachments', ({params, body}) => created(attachments.add(Number(params.id), body ?? {})));
    r.get('/attachments/counts', () => attachments.counts());
    r.get('/attachments/:id', ({params}) => {
        const file = attachments.file(Number(params.id));
        return {status: 200, bytes: file.bytes, contentType: file.contentType};
    });
    r.delete('/attachments/:id', ({params}) => attachments.delete(Number(params.id)));

    // caixinhas
    r.get('/pots', () => pots.list());
    r.post('/pots', ({body}) => created(pots.create(body ?? {})));
    r.put('/pots/:id', ({params, body}) => pots.update(Number(params.id), body ?? {}));
    r.delete('/pots/entries/:entryId', ({params}) => pots.deleteEntry(Number(params.entryId)));
    r.delete('/pots/:id', ({params}) => pots.delete(Number(params.id)));
    r.get('/pots/:id/entries', ({params}) => pots.entries(Number(params.id)));
    r.post('/pots/:id/deposit', ({params, body}) => pots.deposit(Number(params.id), body));
    r.post('/pots/:id/withdraw', ({params, body}) => pots.withdraw(Number(params.id), body));

    // lista de desejos
    r.get('/wishes', () => wishes.list());
    r.post('/wishes', ({body}) => created(wishes.create(body ?? {})));
    r.put('/wishes/:id', ({params, body}) => wishes.update(Number(params.id), body ?? {}));
    r.delete('/wishes/:id', ({params}) => wishes.delete(Number(params.id)));
    r.post('/wishes/:id/buy', ({params, body}) => wishes.buy(Number(params.id), body ?? {}));
    r.post('/wishes/:id/discard', ({params}) => wishes.discard(Number(params.id)));
    r.post('/wishes/:id/restore', ({params}) => wishes.restore(Number(params.id)));

    // faturas de cartao de credito
    r.get('/accounts/:id/invoices', ({params}) => invoices.list(Number(params.id)).map(publicInvoice));
    r.get('/accounts/:id/invoices/:month', ({params}) => publicInvoice(invoices.get(Number(params.id), params.month)));
    r.post('/accounts/:id/invoices/:month/pay', ({params, body}) =>
        created(publicInvoice(invoices.pay(Number(params.id), params.month, body ?? {}))));

    // lixeira
    r.get('/trash', () => trash.list());
    r.post('/trash/:kind/:id/restore', ({params}) => trash.restore(params.kind, Number(params.id)));
    r.delete('/trash/:kind/:id', ({params}) => trash.purge(params.kind, Number(params.id)));
    r.delete('/trash', () => trash.empty());

    // orcamentos
    r.get('/budgets', ({query}) => budgets.effectiveInMonth(budgets.monthParam(query.month, thisMonth(db))));
    r.get('/budgets/total', ({query}) => budgets.total(budgets.monthParam(query.month, thisMonth(db))));
    r.put('/budgets/total', ({query, body}) => {
        const month = budgets.monthParam(query.month, thisMonth(db));
        budgets.set(null, month, body.amount, budgets.parseRequest(body));
        return budgets.total(month);
    });
    r.delete('/budgets/total', ({query}) => budgets.remove(null, budgets.monthParam(query.month, thisMonth(db))));
    r.put('/budgets/:categoryId', ({params, query, body}) => {
        const month = budgets.monthParam(query.month, thisMonth(db));
        const id = Number(params.categoryId);
        budgets.set(id, month, body.amount, budgets.parseRequest(body));
        return budgets.effectiveInMonth(month).find(e => e.categoryId === id);
    });
    r.delete('/budgets/:categoryId', ({params, query}) =>
        budgets.remove(Number(params.categoryId), budgets.monthParam(query.month, thisMonth(db))));

    // painel e configuracoes
    r.get('/api/summary', ({query}) => summary.summarize(budgets.monthParam(query.month, thisMonth(db)),
        query.accountId ? Number(query.accountId) : null));
    r.get('/api/upcoming', ({query}) => upcoming.compute(query.from, query.to, query.accountId ? Number(query.accountId) : null));
    r.get('/api/settings', () => settings.snapshot());
    r.put('/api/settings', ({body}) => {
        const b = body ?? {};
        db.tx(() => {
            if (b.autoPayRecurring != null) {
                settings.setString('autoPayRecurring', b.autoPayRecurring);
                recurring.sync(); // ligar o pagamento automatico paga na hora o que ja venceu
            }
            if (b.budgetRollover != null) settings.setBudgetRollover(b.budgetRollover);
            if (b.currency != null) settings.setCurrency(b.currency);
            if (b.remindersEnabled != null) settings.setString('remindersEnabled', b.remindersEnabled);
            if (b.reminderDays != null) settings.setReminderDays(b.reminderDays);
            if (b.autoBackup != null) settings.setString('autoBackup', b.autoBackup);
        });
        return settings.snapshot();
    });
    r.post('/api/demo-data', () => { demo.load(); return noContent(); });
    r.delete('/api/data', () => { expenses.trashAll(); return noContent(); });
    r.get('/api/export.csv', () => ({status: 200, text: exportCsv(db), contentType: 'text/csv;charset=UTF-8'}));
    r.get('/api/reminders', () => reminders.current(db.clock));
    r.get('/api/about', () => ({version: APP_VERSION, dataFolder: 'dentro do aplicativo, neste aparelho', startupAvailable: false, startupEnabled: false}));
    r.post('/api/about/open-data-folder', () => { throw new HttpError(403, 'Os dados ficam dentro do aplicativo. Para tirar uma cópia, use o backup.'); });

    // o aparelho e so de quem o segura: sem senha, sem perfis (por enquanto)
    r.get('/api/auth/status', () => ({passwordSet: false, unlocked: true, localOnly: true}));
    r.get('/profiles', () => profiles(settings));
    r.put('/app/language', ({body}) => { settings.setLanguage(body?.language); return profiles(settings); });

    // ainda nao portados: listas vazias para o app abrir; gravar avisa que falta
    r.post('/profiles', notYet);
}

const thisMonth = db => isoDate(db.clock()).slice(0, 7);

function profiles(settings) {
    return {profiles: [{id: 'main', name: 'Principal'}], current: 'main', language: settings.language()};
}
