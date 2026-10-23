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
    // Seçili kaynakla ekran paylaşımını başlatır (getDisplayMedia handler'ını tetikler)
    startShare: () => ipcRenderer.invoke('lumo:start-share'),
    // İşletim sistemi uzaktan kontrolü destekliyor mu (Windows masaüstü)
    isRemoteSupported: () => ipcRenderer.invoke('lumo:is-remote-supported'),
    // Uzaktan kontrol girdisini işletim sistemine ilet
    remoteInput: (cmd) => ipcRenderer.invoke('lumo:remote-input', cmd),
    // Pencereyi küçült / geri getir (uzaktan kontrol devreye girdiğinde)
    minimizeWindow: () => ipcRenderer.invoke('lumo:minimize'),
    restoreWindow: () => ipcRenderer.invoke('lumo:restore')
});
