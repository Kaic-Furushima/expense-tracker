import {Capacitor} from '@capacitor/core';
import {App} from '@capacitor/app';

// Botao "voltar" do Android. O Capacitor, sozinho, fecha o aplicativo; aqui ele passa a voltar pelas "camadas" do
// front-end (formulario aberto, pagina dentro de Mais, aba que nao e o Inicio), que registram cada uma uma entrada no
// historico do WebView (ver backNav em app.js). So quando nao ha mais nada para voltar, o aplicativo sai.

export function installNativeBack() {
    if (!Capacitor.isNativePlatform()) return;
    App.addListener('backButton', ({canGoBack}) => {
        if (canGoBack) window.history.back();
        else App.exitApp();
    });
}
