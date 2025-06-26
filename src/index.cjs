const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, systemPreferences, shell } = require('electron');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const { Worker } = require('worker_threads');

// 信令服务器
let signalServer;

// Robot Worker 管理
let robotWorker = null;
let robotWorkerReady = false;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: false // 允许访问本地资源
    },
    title: '局域网屏幕共享',
    show: false,
    icon: path.join(__dirname, 'assets/icon.png') // 如果有图标
  });

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 加载应用页面
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 开发环境下打开调试工具
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
};

// IPC事件处理

// 获取桌面源（用于屏幕共享选择）
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 200, height: 150 }
    });
    
    // 获取所有屏幕的详细信息
    const { screen } = require('electron');
    const allDisplays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    
    console.log('[DESKTOP-SOURCES] 获取到的源数量:', sources.length);
    console.log('[DESKTOP-SOURCES] 可用显示器:', allDisplays.map(d => ({
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      isPrimary: d.id === primaryDisplay.id
    })));
    
    return sources.map((source, index) => {
      let screenInfo = null;
      
      console.log(`[DESKTOP-SOURCES] 处理源 ${index}:`, {
        id: source.id,
        name: source.name,
        appIcon: !!source.appIcon
      });
      
      // 优先尝试为屏幕源匹配对应的显示器
      if (source.id.startsWith('screen:')) {
        // 提取屏幕ID，支持多种格式
        const screenMatches = [
          source.id.match(/screen:(\d+)/),           // "screen:0" 格式
          source.id.match(/screen:(\d+):(\d+)/),     // "screen:0:0" 格式
          source.id.match(/(\d+)$/)                  // 以数字结尾的格式
        ];
        
        for (const match of screenMatches) {
          if (match) {
            const screenIndex = parseInt(match[1]);
            const display = allDisplays[screenIndex];
            if (display) {
              screenInfo = {
                bounds: display.bounds,
                workArea: display.workArea,
                scaleFactor: display.scaleFactor,
                isPrimary: display.id === primaryDisplay.id
              };
              console.log(`[DESKTOP-SOURCES] 屏幕源 ${source.id} 匹配到显示器 ${screenIndex}:`, screenInfo);
              break;
            }
          }
        }
      }
      
      // 如果没有匹配到具体的屏幕，使用主显示器信息作为默认值
      if (!screenInfo) {
        screenInfo = {
          bounds: primaryDisplay.bounds,
          workArea: primaryDisplay.workArea,
          scaleFactor: primaryDisplay.scaleFactor,
          isPrimary: true
        };
        console.log(`[DESKTOP-SOURCES] 源 ${source.id} 使用主显示器信息:`, screenInfo);
      }
      
      return {
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        screenInfo: screenInfo
      };
    });
  } catch (error) {
    console.error('获取桌面源失败:', error);
    return [];
  }
});

// 坐标转换辅助函数
function transformCoordinates(data) {
  let actualX = data.x;
  let actualY = data.y;
  console.log('[坐标转换] 原始坐标:', { x: data.x, y: data.y });
  console.log('[坐标转换] 视频分辨率:', data.videoResolution);
  console.log('[坐标转换] 屏幕信息:', data.screenInfo);
  
  // 如果有视频分辨率信息，进行精确的坐标映射
  if (data.videoResolution && data.screenInfo && data.screenInfo.bounds) {
    const bounds = data.screenInfo.bounds;
    const scaleFactor = data.screenInfo.scaleFactor || 1;
    const clientPlatform = data.clientPlatform || 'unknown';
    const videoWidth = data.videoResolution.width;
    const videoHeight = data.videoResolution.height;
    
    // 调试信息
    const debugInfo = {
      serverPlatform: process.platform,
      clientPlatform: clientPlatform,
      originalCoords: { x: data.x, y: data.y },
      videoResolution: { width: videoWidth, height: videoHeight },
      screenBounds: bounds,
      scaleFactor: scaleFactor
    };
    
    // 核心坐标转换逻辑
    if (process.platform === 'darwin' && scaleFactor > 1) {
      // macOS接收端，需要考虑Retina缩放
      if (clientPlatform === 'win32') {
        // Windows -> macOS: 需要考虑视频分辨率和实际屏幕分辨率的映射
        // 视频分辨率通常是逻辑分辨率，需要映射到物理分辨率
        const scaleX = bounds.width / videoWidth;
        const scaleY = bounds.height / videoHeight;
        
        actualX = bounds.x + (data.x * scaleX);
        actualY = bounds.y + (data.y * scaleY);
        
        debugInfo.scaleFactors = { scaleX, scaleY };
      } else {
        // macOS -> macOS: 直接映射
        actualX = bounds.x + data.x;
        actualY = bounds.y + data.y;
      }
    } else {
      // Windows/Linux接收端
      if (clientPlatform === 'darwin') {
        // macOS -> Windows: 使用相对位置映射到物理分辨率
        const relativeX = data.x / videoWidth;
        const relativeY = data.y / videoHeight;
        
        // robotjs在Windows上使用物理坐标系统
        actualX = bounds.x + (relativeX * bounds.width * scaleFactor);
        actualY = bounds.y + (relativeY * bounds.height * scaleFactor);
        
        debugInfo.mappingType = 'relative-to-physical';
        debugInfo.relativePosition = { x: relativeX, y: relativeY };
      } else {
        // Windows -> Windows: 直接映射
        actualX = bounds.x + data.x;
        actualY = bounds.y + data.y;
      }
    }
    
    debugInfo.finalCoords = { x: actualX, y: actualY };
    
    // 只在非鼠标移动事件时打印调试信息
    if (data.type !== 'mousemove' && data.type !== 'mousedrag') {
      console.log('[坐标转换] 详细信息:', debugInfo);
    } else if (Math.random() < 0.001) {
      // 偶尔打印鼠标移动的坐标转换信息用于调试
      console.log('[坐标转换] 鼠标移动采样:', {
        originalCoords: debugInfo.originalCoords,
        finalCoords: debugInfo.finalCoords,
        scaleFactors: debugInfo.scaleFactors,
        platforms: `${debugInfo.clientPlatform} -> ${debugInfo.serverPlatform}`
      });
    }
  } else if (data.screenInfo && data.screenInfo.bounds) {
    // 兜底逻辑：如果没有视频分辨率信息，使用原有逻辑
    const bounds = data.screenInfo.bounds;
    actualX = bounds.x + data.x;
    actualY = bounds.y + data.y;
  }
  
  return { x: Math.round(actualX), y: Math.round(actualY) };
}

/**
 * 初始化 Robot Worker
 */
function initRobotWorker() {
  if (robotWorker) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    try {
      const workerPath = path.join(__dirname, 'lib', 'robot-worker.cjs');
      robotWorker = new Worker(workerPath);
      
      robotWorker.on('message', (message) => {
        switch (message.type) {
          case 'ready':
            robotWorkerReady = true;
            console.log('[Robot Worker] 已就绪:', message.message, 'PID:', message.pid);
            resolve();
            break;
            
          case 'processed':
            // 可选：记录处理完成的操作
            if (Math.random() < 0.001) { // 偶尔记录，避免日志过多
              console.log('[Robot Worker] 处理完成:', message.originalType);
            }
            break;
            
          case 'error':
            console.error('[Robot Worker] 处理错误:', message.message);
            break;
        }
      });
      
      robotWorker.on('error', (error) => {
        console.error('[Robot Worker] Worker错误:', error);
        robotWorkerReady = false;
      });
      
      robotWorker.on('exit', (code) => {
        console.log('[Robot Worker] Worker退出，代码:', code);
        robotWorkerReady = false;
        robotWorker = null;
      });
      
    } catch (error) {
      console.error('[Robot Worker] 初始化失败:', error);
      reject(error);
    }
  });
}

/**
 * 清理 Robot Worker
 */
function cleanupRobotWorker() {
  if (robotWorker) {
    console.log('[Robot Worker] 正在关闭...');
    robotWorker.terminate();
    robotWorker = null;
    robotWorkerReady = false;
  }
}

// 远程控制事件处理 - 使用 Worker 优化
ipcMain.on('remote-control', async (event, data) => {
  try {
    // 确保 Robot Worker 已初始化
    if (!robotWorkerReady) {
      try {
        await initRobotWorker();
      } catch (error) {
        console.error('[远程控制] Robot Worker 初始化失败:', error);
        return;
      }
    }

    // 输出调试信息（减少频率）
    if (data.type !== 'mousemove' && data.type !== 'mousedrag') {
      console.log('[远程控制] 执行命令:', {
        type: data.type,
        hasVideoResolution: !!(data.videoResolution),
        hasScreenInfo: !!(data.screenInfo),
        clientPlatform: data.clientPlatform,
        serverPlatform: process.platform
      });
    } else if (Math.random() < 0.001) {
      // 偶尔打印鼠标移动信息用于调试
      console.log('[远程控制] 鼠标移动采样:', {
        type: data.type,
        hasCoords: !!(data.x !== undefined && data.y !== undefined),
        clientPlatform: data.clientPlatform
      });
    }

    // 将命令发送给 Robot Worker 处理
    if (robotWorker && robotWorkerReady) {
      robotWorker.postMessage({
        type: 'command',
        data: data
      });
    } else {
      console.warn('[远程控制] Robot Worker 未就绪，跳过命令:', data.type);
    }

  } catch (error) {
    console.error('[远程控制] 操作失败:', error);
  }
});

// 新增：处理 macOS 屏幕录制权限
ipcMain.handle('manage-screen-permission', async () => {
  if (process.platform !== 'darwin') {
    return true; // 非 macOS 平台无需权限
  }

  const status = systemPreferences.getMediaAccessStatus('screen');

  if (status === 'granted') {
    return true;
  }

  // 如果权限被拒绝，引导用户去系统设置
  if (status === 'denied') {
    // 使用 shell 模块打开指定的系统设置面板
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    return false;
  }
  
  // 如果是 'not-determined'，意味着下一次调用 getSources() 时会弹出系统提示。
  // 我们返回 true，让渲染进程继续，由操作系统来处理弹窗。
  // 在开发环境中，这一步不会弹窗，需要手动授权终端。
  if (status === 'not-determined') {
    return true;
  }

  return false;
});

// 生成房间ID
ipcMain.handle('generate-room-id', () => {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
});

// 获取本机网络信息
ipcMain.handle('get-network-info', () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          interface: name,
          address: iface.address,
          netmask: iface.netmask
        });
      }
    }
  }

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    addresses: addresses
  };
});

// 获取系统显示信息（用于调试）
ipcMain.handle('get-display-info', () => {
  const { screen } = require('electron');
  const allDisplays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  
  return {
    platform: process.platform,
    allDisplays: allDisplays.map(display => ({
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      isPrimary: display.id === primaryDisplay.id,
      size: display.size,
      workAreaSize: display.workAreaSize
    })),
    primaryDisplay: {
      id: primaryDisplay.id,
      bounds: primaryDisplay.bounds,
      scaleFactor: primaryDisplay.scaleFactor
    }
  };
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
  // 创建主窗口
  createWindow();

  // 预初始化 Robot Worker（提前准备，避免首次使用时的延迟）
  try {
    await initRobotWorker();
    console.log('[应用初始化] Robot Worker 预初始化完成');
  } catch (error) {
    console.warn('[应用初始化] Robot Worker 预初始化失败，将在需要时重试:', error.message);
  }

  // 注册全局快捷键
  globalShortcut.register('CmdOrCtrl+Shift+S', () => {
    console.log('快捷键触发: 开始/停止屏幕共享');
    // 这里可以触发屏幕共享的开始/停止
  });

  globalShortcut.register('CmdOrCtrl+Shift+Q', () => {
    console.log('快捷键触发: 快速退出');
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // 取消注册所有快捷键
  globalShortcut.unregisterAll();
  
  // 清理 Robot Worker
  cleanupRobotWorker();
});

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
});
