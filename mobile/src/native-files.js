import {Capacitor, registerPlugin} from '@capacitor/core';
import {Directory, Encoding, Filesystem} from '@capacitor/filesystem';
import {Share} from '@capacitor/share';

// No Android o WebView nao baixa arquivos de links "download". Aqui o arquivo e gravado no cache do app e entregue
// ao menu "Compartilhar" do sistema (Drive, WhatsApp, e-mail, "Salvar em arquivos"...). No navegador comum nada muda:
// o front-end continua usando o link de download.

async function share(name, options) {
    try {
        const {uri} = await Filesystem.writeFile({path: name, directory: Directory.Cache, ...options});
        await Share.share({title: name, url: uri, dialogTitle: 'Salvar ou enviar o arquivo'});
    } catch (e) {
        if (/cancel/i.test(String(e && e.message))) return; // a pessoa fechou o menu
        throw e;
    }
}

const BackupFolder = registerPlugin('BackupFolder');

/**
 * Pasta de backups escolhida pela pessoa (so no Android). `store` guarda {uri, name}; a permissao da pasta fica com o sistema.
 * Devolve null fora do aplicativo (navegador): la nao existe seletor de pastas.
 */
export function createNativeBackupFolder(store) {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('BackupFolder')) return null;
    const need = async () => {
        const current = await store.get();
        if (!current) throw new Error('Nenhuma pasta escolhida.');
        return current.uri;
    };
    return {
        get: async () => (await store.get()) ?? null,
        async pick() {
            const picked = await BackupFolder.pick();
            if (!picked.uri) return null;
            const previous = await store.get();
            await store.set({uri: picked.uri, name: picked.name});
            if (previous && previous.uri !== picked.uri) await BackupFolder.release({uri: previous.uri}).catch(() => {});
            return picked;
        },
        async clear() {
            const previous = await store.get();
            await store.set(null);
            if (previous) await BackupFolder.release({uri: previous.uri}).catch(() => {});
        },
        write: async (name, text) => BackupFolder.write({uri: await need(), name, text}),
        list: async () => (await BackupFolder.list({uri: await need()})).names,
        remove: async name => BackupFolder.remove({uri: await need(), name})
    };
}

export function installNativeFiles() {
    if (!Capacitor.isNativePlatform()) return;
    window.nativeFiles = {
        saveText: (name, text) => share(name, {data: text, encoding: Encoding.UTF8}),
        saveBytes: (name, base64) => share(name, {data: base64})
    };
}
