// Dados iniciais do primeiro uso: formas de pagamento, a conta principal e as categorias padrao no idioma do app.

const METHODS = ['Pix', 'Débito', 'Crédito', 'Dinheiro', 'Boleto', 'Transferência'];

const CATEGORY_STYLE = [
    ['🍽️', '#E57373'], ['🛒', '#81C784'], ['🏠', '#64B5F6'], ['🚌', '#FFB74D'], ['💊', '#4DB6AC'], ['🎮', '#BA68C8'],
    ['📚', '#7986CB'], ['📺', '#F06292'], ['📈', '#AED581'], ['💰', '#FFD54F'], ['📦', '#A1887F']
];

const CATEGORY_NAMES = {
    pt: ['Alimentação', 'Mercado', 'Moradia', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Assinaturas', 'Investimentos', 'Salário', 'Outros'],
    en: ['Food', 'Groceries', 'Housing', 'Transport', 'Health', 'Leisure', 'Education', 'Subscriptions', 'Investments', 'Salary', 'Other'],
    es: ['Comida', 'Supermercado', 'Vivienda', 'Transporte', 'Salud', 'Ocio', 'Educación', 'Suscripciones', 'Inversiones', 'Salario', 'Otros']
};

/** Insere o que falta; nao mexe em nada se o banco ja tem dados. */
export function seed(db, language = 'pt') {
    db.tx(() => {
        if (db.value('select count(*) from payment_methods') === 0) {
            for (const name of METHODS) {
                db.run('insert into payment_methods (uuid, name, updated_at) values (?, ?, ?)', [db.newId(), name, db.now()]);
            }
        }
        if (db.value('select count(*) from accounts') === 0) {
            db.run(`insert into accounts (uuid, name, type, color, icon, initial_cents, archived, updated_at)
                    values (?, 'Conta principal', 'CHECKING', '#2F7D6D', 'wallet', 0, 0, ?)`, [db.newId(), db.now()]);
        }
        seedCategories(db, language);
    });
}

export function seedCategories(db, language = 'pt') {
    if (db.value('select count(*) from categories') > 0) return;
    const names = CATEGORY_NAMES[language] ?? CATEGORY_NAMES.pt;
    CATEGORY_STYLE.forEach(([icon, color], i) => {
        db.run('insert into categories (uuid, name, icon, color, updated_at) values (?, ?, ?, ?, ?)', [db.newId(), names[i], icon, color, db.now()]);
    });
}
