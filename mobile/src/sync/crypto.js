// Criptografia ponta a ponta: o servidor so guarda texto cifrado. A chave nasce de uma senha de sync que nunca sai dos
// aparelhos (PBKDF2-HMAC-SHA256 -> AES-256-GCM). O computador usa exatamente o mesmo formato:
//   texto cifrado = "v1." + base64(iv de 12 bytes) + "." + base64(cifrado + etiqueta GCM de 16 bytes)
// A "salt" e um valor aleatorio guardado no servidor (junto com uma prova da senha), igual para todos os aparelhos.

const ITERATIONS = 310000;
const VERIFY_TEXT = 'expense-tracker-sync';
const enc = new TextEncoder();
const dec = new TextDecoder();

/** Em pedacos: String.fromCharCode(...bytes) estoura a pilha com dados grandes (um anexo, por exemplo). */
const b64 = bytes => {
    const view = new Uint8Array(bytes);
    let text = '';
    for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000));
    return btoa(text);
};
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

export class SyncCrypto {
    constructor(key) {
        this.key = key;
    }

    static async fromPassword(password, salt, iterations = ITERATIONS) {
        const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey(
            {name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations},
            material, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
        return new SyncCrypto(key);
    }

    async encrypt(text) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, this.key, enc.encode(text));
        return `v1.${b64(iv)}.${b64(data)}`;
    }

    async decrypt(token) {
        const [version, iv, data] = String(token).split('.');
        if (version !== 'v1' || !iv || !data) throw new Error('Formato de dados do sync desconhecido.');
        try {
            return dec.decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(iv)}, this.key, unb64(data)));
        } catch {
            throw new Error('Senha de sync incorreta ou dados corrompidos.');
        }
    }

    /** Prova que a senha esta certa sem revelar nada: cifra um texto fixo. */
    makeCheck() {
        return this.encrypt(VERIFY_TEXT);
    }

    async verify(check) {
        return (await this.decrypt(check)) === VERIFY_TEXT;
    }
}
