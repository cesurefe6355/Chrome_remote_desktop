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
<<<<<<< HEAD
    remoteInput: (cmd) => ipcRenderer.invoke('lumo:remote-input', cmd),
    // Pencereyi küçült / geri getir (uzaktan kontrol devreye girdiğinde)
    minimizeWindow: () => ipcRenderer.invoke('lumo:minimize'),
    restoreWindow: () => ipcRenderer.invoke('lumo:restore')
=======
    remoteInput: (cmd) => ipcRenderer.invoke('lumo:remote-input', cmd)
>>>>>>> 99fbee43b22a816ce2e0c9eea021d83d26a509c0
});
