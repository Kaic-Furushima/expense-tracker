import {badRequest} from './http.js';
import {isoDate} from './util.js';

export const CURRENCIES = ['BRL', 'USD', 'EUR', 'GBP', 'ARS', 'CLP', 'MXN', 'JPY'];

/** Configuracoes do app (tabela app_settings), como o SettingsService do Java. */
export class Settings {
    /** languageStore ({get, set}) guarda o idioma fora do banco, para valer para todos os perfis do app. */
    constructor(db, languageStore = null) {
        this.db = db;
        this.languageStore = languageStore;
    }

    getString(key) {
        return this.db.value('select setting_value from app_settings where setting_key = ?', [key]);
    }

    setString(key, value) {
        this.db.run(`insert into app_settings (setting_key, setting_value, updated_at) values (?, ?, ?)
                     on conflict(setting_key) do update set setting_value = excluded.setting_value, updated_at = excluded.updated_at`,
            [key, String(value), this.db.now()]);
    }

    remove(key) {
        this.db.run('delete from app_settings where setting_key = ?', [key]);
    }

    getBoolean(key, fallback) {
        const value = this.getString(key);
        return value == null ? fallback : value === 'true';
    }

    autoPayRecurring() { return this.getBoolean('autoPayRecurring', false); }
    budgetRollover() { return this.getBoolean('budgetRollover', false); }
    remindersEnabled() { return this.getBoolean('remindersEnabled', true); }
    autoBackup() { return this.getBoolean('autoBackup', false); }

    /** Mes em que a sobra acumulada comecou a contar; so existe enquanto ela esta ligada. */
    budgetRolloverFrom() {
        if (!this.budgetRollover()) return null;
        return this.getString('budgetRolloverFrom') ?? isoDate(this.db.clock()).slice(0, 7);
    }

    setBudgetRollover(on) {
        if (on && !this.budgetRollover()) this.setString('budgetRolloverFrom', isoDate(this.db.clock()).slice(0, 7));
        this.setString('budgetRollover', on);
        if (!on) this.remove('budgetRolloverFrom');
    }

    reminderDays() {
        const n = parseInt(this.getString('reminderDays') ?? '3', 10);
        return Number.isNaN(n) ? 3 : Math.max(1, Math.min(15, n));
    }

    setReminderDays(days) {
        if (!Number.isInteger(days) || days < 1 || days > 15) throw badRequest('Avise de 1 a 15 dias antes.');
        this.setString('reminderDays', days);
    }

    currency() {
        const code = this.getString('currency');
        return CURRENCIES.includes(code) ? code : 'BRL';
    }

    setCurrency(code) {
        const upper = String(code ?? '').trim().toUpperCase();
        if (!CURRENCIES.includes(upper)) throw badRequest('Moeda não suportada.');
        this.setString('currency', upper);
    }

    language() {
        const lang = this.languageStore ? this.languageStore.get() : this.getString('language');
        return ['pt', 'en', 'es'].includes(lang) ? lang : 'pt';
    }

    setLanguage(lang) {
        if (!['pt', 'en', 'es'].includes(lang)) throw badRequest('Idioma não suportado.');
        if (this.languageStore) this.languageStore.set(lang);
        else this.setString('language', lang);
    }

    snapshot() {
        return {
            autoPayRecurring: this.autoPayRecurring(),
            budgetRollover: this.budgetRollover(),
            budgetRolloverFrom: this.budgetRolloverFrom(),
            currency: this.currency(),
            remindersEnabled: this.remindersEnabled(),
            reminderDays: this.reminderDays(),
            autoBackup: this.autoBackup()
        };
    }
}
