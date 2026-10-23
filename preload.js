// Electron ile web sayfası arasında güvenli köprü.
// Sayfaya yalnızca gerekli fonksiyonlar açılır (nodeIntegration kapalı).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumoDesktop', {
    isElectron: true,
    platform: process.platform,
    // Paylaşılabilecek ekran ve pencereleri (küçük önizleme görselleriyle) getirir
    getSources: () => ipcRenderer.invoke('lumo:get-sources'),
    // Kullanıcının seçtiği kaynağı ana sürece bildirir (yayın başlatmadan hemen önce)
    pickSource: (id) => ipcRenderer.invoke('lumo:pick-source', String(id)),
    // İşletim sistemi uzaktan kontrolü destekliyor mu (Windows masaüstü)
    isRemoteSupported: () => ipcRenderer.invoke('lumo:is-remote-supported'),
    // Uzaktan kontrol girdisini işletim sistemine ilet
    remoteInput: (cmd) => ipcRenderer.invoke('lumo:remote-input', cmd)
});
