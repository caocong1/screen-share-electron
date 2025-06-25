const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 桌面源相关
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  
  // 远程控制相关
  sendRemoteControl: (data) => ipcRenderer.send('remote-control', data),
  
  // 房间管理
  generateRoomId: () => ipcRenderer.invoke('generate-room-id'),
  
  // 网络信息
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
  
  // 新增：macOS 屏幕录制权限管理
  manageScreenPermission: () => ipcRenderer.invoke('manage-screen-permission'),
  
  // 平台信息
  platform: process.platform
});

// 监听来自主进程的消息
ipcRenderer.on('app-message', (event, message) => {
  window.postMessage({ type: 'app-message', data: message }, '*');
});

console.log('Preload脚本已加载');
