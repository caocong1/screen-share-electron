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
  
  // 获取显示信息（用于调试缩放问题）
  getDisplayInfo: () => ipcRenderer.invoke('get-display-info'),
  
  // 获取窗口详细信息（包括实际位置和大小）
  getWindowDetails: (sourceId) => ipcRenderer.invoke('get-window-details', sourceId),
  
  // 新增：全局鼠标监听API
  startGlobalMouseListening: () => ipcRenderer.invoke('start-global-mouse-listening'),
  stopGlobalMouseListening: () => ipcRenderer.invoke('stop-global-mouse-listening'),
  registerGlobalMouseEvents: () => ipcRenderer.invoke('register-global-mouse-events'),
  toggleSystemCursor: (hide) => ipcRenderer.invoke('toggle-system-cursor', hide),
  getCurrentMousePosition: () => ipcRenderer.invoke('get-current-mouse-position'),
  
  // 监听全局鼠标事件
  onGlobalMouseMove: (callback) => {
    ipcRenderer.on('global-mouse-move', (event, data) => callback(data));
  },
  onCursorVisibilityChanged: (callback) => {
    ipcRenderer.on('cursor-visibility-changed', (event, data) => callback(data));
  },
  
  // 移除监听器
  removeGlobalMouseListeners: () => {
    ipcRenderer.removeAllListeners('global-mouse-move');
    ipcRenderer.removeAllListeners('cursor-visibility-changed');
  },
  
  // 平台信息
  platform: process.platform
});

// 监听来自主进程的消息
ipcRenderer.on('app-message', (event, message) => {
  window.postMessage({ type: 'app-message', data: message }, '*');
});

console.log('Preload脚本已加载');
