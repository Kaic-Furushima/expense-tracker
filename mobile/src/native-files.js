import {Capacitor} from '@capacitor/core';
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

export function installNativeFiles() {
    if (!Capacitor.isNativePlatform()) return;
    window.nativeFiles = {
        saveText: (name, text) => share(name, {data: text, encoding: Encoding.UTF8}),
        saveBytes: (name, base64) => share(name, {data: base64})
    };
}
