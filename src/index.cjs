const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, systemPreferences, shell } = require('electron');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const { Worker } = require('worker_threads');

// RobotJS for global mouse listening
let robot;
try {
  robot = require('robotjs');
} catch (error) {
  console.warn('[主进程] RobotJS 不可用:', error.message);
  robot = null;
}

// 信令服务器
let signalServer;

// Robot Worker 管理
let robotWorker = null;
let robotWorkerReady = false;

// 全局鼠标监听状态
let globalMouseListening = false;
let mouseListenerInterval = null;
let lastMousePosition = { x: 0, y: 0 };
let mouseButtonState = { left: false, right: false, middle: false };

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
    console.log('[DESKTOP-SOURCES] 获取到的源:', sources);
    
    // 获取所有屏幕的详细信息
    const { screen } = require('electron');
    const allDisplays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    
    // 获取所有窗口的位置信息（仅在 macOS 上）
    const allWindowsInfo = await getAllWindowsInfo();
    
    console.log('[DESKTOP-SOURCES] 获取到的源数量:', sources.length);
    console.log('[DESKTOP-SOURCES] 可用显示器:', allDisplays.map(d => ({
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      isPrimary: d.id === primaryDisplay.id
    })));
    
    return sources.map((source, index) => {
      let screenInfo = null;
      let windowInfo = null;
      
      console.log(`[DESKTOP-SOURCES] 处理源 ${index}:`, {
        id: source.id,
        name: source.name,
        appIcon: !!source.appIcon,
        display_id: source.display_id
      });
      
      // 处理屏幕源
      if (source.id.startsWith('screen:')) {
        // 优先使用 display_id 匹配显示器
        if (source.display_id) {
          const display = allDisplays.find(d => d.id.toString() === source.display_id.toString());
          if (display) {
            screenInfo = {
              bounds: display.bounds,
              workArea: display.workArea,
              scaleFactor: display.scaleFactor,
              isPrimary: display.id === primaryDisplay.id,
              displayId: display.id
            };
            console.log(`[DESKTOP-SOURCES] 屏幕源 ${source.id} 通过display_id匹配到显示器:`, screenInfo);
          }
        }
        
        // 如果 display_id 匹配失败，使用传统方法
        if (!screenInfo) {
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
                  isPrimary: display.id === primaryDisplay.id,
                  displayId: display.id
                };
                console.log(`[DESKTOP-SOURCES] 屏幕源 ${source.id} 通过索引匹配到显示器 ${screenIndex}:`, screenInfo);
                break;
              }
            }
          }
        }
      }
      // 处理窗口源
      else if (source.id.startsWith('window:')) {
        // 首先尝试通过窗口名称匹配实际窗口位置
        const matchedWindow = findBestWindowMatch(source.name, allWindowsInfo);
        
        if (matchedWindow) {
          // 找到匹配的窗口，使用实际位置信息
          const windowX = matchedWindow.x;
          const windowY = matchedWindow.y;
          const windowWidth = matchedWindow.width;
          const windowHeight = matchedWindow.height;
          
          // 查找包含此窗口的显示器
          const containingDisplay = allDisplays.find(display => {
            const bounds = display.bounds;
            return windowX >= bounds.x && 
                   windowX < bounds.x + bounds.width &&
                   windowY >= bounds.y && 
                   windowY < bounds.y + bounds.height;
          });
          
          if (containingDisplay) {
            screenInfo = {
              bounds: {
                x: windowX,
                y: windowY,
                width: windowWidth,
                height: windowHeight
              },
              workArea: containingDisplay.workArea,
              scaleFactor: containingDisplay.scaleFactor,
              isPrimary: containingDisplay.id === primaryDisplay.id,
              displayId: containingDisplay.id,
              actualWindowBounds: {
                x: windowX,
                y: windowY,
                width: windowWidth,
                height: windowHeight
              },
              relativePosition: {
                x: windowX - containingDisplay.bounds.x,
                y: windowY - containingDisplay.bounds.y
              }
            };
            
            windowInfo = {
              type: 'window',
              appName: matchedWindow.appName,
              windowName: matchedWindow.windowName,
              actualPosition: true,
              thumbnailSize: {
                width: source.thumbnail ? source.thumbnail.getSize().width : null,
                height: source.thumbnail ? source.thumbnail.getSize().height : null
              }
            };
            
            console.log(`[DESKTOP-SOURCES] 窗口源 ${source.id} 找到实际位置:`, {
              windowName: source.name,
              actualBounds: screenInfo.bounds,
              displayId: containingDisplay.id,
              displayBounds: containingDisplay.bounds
            });
          } else {
            // 窗口位置超出所有显示器范围，可能是窗口在屏幕外
            console.warn(`[DESKTOP-SOURCES] 窗口 ${source.name} 位置超出显示器范围:`, {
              windowPos: { x: windowX, y: windowY },
              displays: allDisplays.map(d => d.bounds)
            });
          }
        }
        
        // 如果没有找到匹配的窗口，尝试通过 display_id 匹配显示器
        if (!screenInfo && source.display_id) {
          const display = allDisplays.find(d => d.id.toString() === source.display_id.toString());
          if (display) {
            screenInfo = {
              bounds: display.bounds,
              workArea: display.workArea,
              scaleFactor: display.scaleFactor,
              isPrimary: display.id === primaryDisplay.id,
              displayId: display.id
            };
            
            windowInfo = {
              type: 'window',
              appName: source.name,
              thumbnailSize: {
                width: source.thumbnail ? source.thumbnail.getSize().width : null,
                height: source.thumbnail ? source.thumbnail.getSize().height : null
              }
            };
            
            console.log(`[DESKTOP-SOURCES] 窗口源 ${source.id} 通过display_id匹配到显示器:`, screenInfo);
          }
        }
        
        // 如果仍然无法确定窗口位置，使用主显示器作为估算
        if (!screenInfo) {
          screenInfo = {
            bounds: primaryDisplay.bounds,
            workArea: primaryDisplay.workArea,
            scaleFactor: primaryDisplay.scaleFactor,
            isPrimary: true,
            displayId: primaryDisplay.id,
            estimated: true // 标记为估算值
          };
          
          windowInfo = {
            type: 'window',
            appName: source.name,
            thumbnailSize: {
              width: source.thumbnail ? source.thumbnail.getSize().width : null,
              height: source.thumbnail ? source.thumbnail.getSize().height : null
            },
            estimated: true
          };
          
          console.log(`[DESKTOP-SOURCES] 窗口源 ${source.id} 无法确定显示器，使用主显示器作为估算:`, screenInfo);
        }
      }
      
      // 如果仍然没有匹配到具体的屏幕，使用主显示器信息作为默认值
      if (!screenInfo) {
        screenInfo = {
          bounds: primaryDisplay.bounds,
          workArea: primaryDisplay.workArea,
          scaleFactor: primaryDisplay.scaleFactor,
          isPrimary: true,
          displayId: primaryDisplay.id,
          fallback: true
        };
        console.log(`[DESKTOP-SOURCES] 源 ${source.id} 使用主显示器信息作为后备:`, screenInfo);
      }
      
      const result = {
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        screenInfo: screenInfo,
        display_id: source.display_id
      };
      
      // 如果是窗口源，添加窗口信息
      if (windowInfo) {
        result.windowInfo = windowInfo;
      }
      
      return result;
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

// 获取所有窗口的位置信息（macOS 专用）
async function getAllWindowsInfo() {
  if (process.platform !== 'darwin') {
    return {};
  }

  const { exec } = require('child_process');
  const util = require('util');
  const execPromise = util.promisify(exec);
  
  try {
    // 使用 AppleScript 获取所有可见窗口的信息
    const { stdout } = await execPromise(`
      osascript -e '
        tell application "System Events"
          set windowList to {}
          repeat with proc in application processes
            try
              if visible of proc is true then
                set procName to name of proc
                repeat with win in windows of proc
                  try
                    set windowName to name of win
                    set windowPosition to position of win
                    set windowSize to size of win
                    set windowInfo to procName & "::" & windowName & "::" & (item 1 of windowPosition) & "::" & (item 2 of windowPosition) & "::" & (item 1 of windowSize) & "::" & (item 2 of windowSize)
                    set end of windowList to windowInfo
                  end try
                end repeat
              end if
            end try
          end repeat
          
          set AppleScript'"'"'s text item delimiters to "|||"
          set windowListString to windowList as string
          set AppleScript'"'"'s text item delimiters to ""
          return windowListString
        end tell
      '
    `);
    
    const windowsInfo = {};
    const windowEntries = stdout.trim().split('|||');
    
    for (const entry of windowEntries) {
      if (entry.trim() === '') continue;
      
      const [appName, windowName, x, y, width, height] = entry.split('::');
      if (appName && windowName && x && y && width && height) {
        const key = `${appName}:${windowName}`;
        windowsInfo[key] = {
          appName: appName,
          windowName: windowName,
          x: parseInt(x),
          y: parseInt(y),
          width: parseInt(width),
          height: parseInt(height)
        };
      }
    }
    
    console.log(`[ALL-WINDOWS] 获取到 ${Object.keys(windowsInfo).length} 个窗口信息`);
    return windowsInfo;
    
  } catch (error) {
    console.log('[ALL-WINDOWS] 无法获取窗口列表:', error.message);
    return {};
  }
}

// 根据窗口名称查找最佳匹配的窗口位置
function findBestWindowMatch(sourceName, allWindowsInfo) {
  const sourceNameLower = sourceName.toLowerCase();
  
  // 精确匹配窗口名称
  for (const [key, info] of Object.entries(allWindowsInfo)) {
    if (info.windowName.toLowerCase() === sourceNameLower) {
      console.log(`[WINDOW-MATCH] 精确匹配: ${sourceName} -> ${key}`);
      return info;
    }
  }
  
  // 部分匹配窗口名称
  for (const [key, info] of Object.entries(allWindowsInfo)) {
    if (info.windowName.toLowerCase().includes(sourceNameLower) || 
        sourceNameLower.includes(info.windowName.toLowerCase())) {
      console.log(`[WINDOW-MATCH] 部分匹配: ${sourceName} -> ${key}`);
      return info;
    }
  }
  
  // 匹配应用名称
  for (const [key, info] of Object.entries(allWindowsInfo)) {
    if (info.appName.toLowerCase() === sourceNameLower) {
      console.log(`[WINDOW-MATCH] 应用名匹配: ${sourceName} -> ${key}`);
      return info;
    }
  }
  
  console.log(`[WINDOW-MATCH] 未找到匹配: ${sourceName}`);
  return null;
}

// 获取窗口详细信息（包括实际位置和大小）
ipcMain.handle('get-window-details', async (event, sourceId) => {
  try {
    if (!sourceId.startsWith('window:')) {
      return null;
    }

    const { screen } = require('electron');
    const allDisplays = screen.getAllDisplays();
    
    // 在 macOS 上，我们可以尝试获取更多窗口信息
    if (process.platform === 'darwin') {
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      try {
        // 使用 osascript 获取前台应用的窗口信息
        const { stdout } = await execPromise(`
          osascript -e '
            tell application "System Events"
              set frontApp to first application process whose frontmost is true
              set appName to name of frontApp
              try
                set frontWindow to first window of frontApp
                set windowPosition to position of frontWindow
                set windowSize to size of frontWindow
                return appName & "|" & (item 1 of windowPosition) & "|" & (item 2 of windowPosition) & "|" & (item 1 of windowSize) & "|" & (item 2 of windowSize)
              on error
                return appName & "|unknown"
              end try
            end tell
          '
        `);
        
        const [appName, x, y, width, height] = stdout.trim().split('|');
        
        if (x !== 'unknown' && y !== 'unknown') {
          // 找到窗口所在的显示器
          const windowX = parseInt(x);
          const windowY = parseInt(y);
          const windowWidth = parseInt(width);
          const windowHeight = parseInt(height);
          
          // 查找包含此窗口的显示器
          const containingDisplay = allDisplays.find(display => {
            const bounds = display.bounds;
            return windowX >= bounds.x && 
                   windowX < bounds.x + bounds.width &&
                   windowY >= bounds.y && 
                   windowY < bounds.y + bounds.height;
          });
          
          if (containingDisplay) {
            return {
              appName: appName,
              windowBounds: {
                x: windowX,
                y: windowY,
                width: windowWidth,
                height: windowHeight
              },
              displayInfo: {
                id: containingDisplay.id,
                bounds: containingDisplay.bounds,
                workArea: containingDisplay.workArea,
                scaleFactor: containingDisplay.scaleFactor
              },
              // 计算窗口在显示器内的相对位置
              relativePosition: {
                x: windowX - containingDisplay.bounds.x,
                y: windowY - containingDisplay.bounds.y
              }
            };
          }
        }
      } catch (error) {
        console.log('[窗口详情] 无法获取窗口位置信息:', error.message);
      }
    }
    
    // 如果无法获取精确位置，返回基本信息
    return {
      platform: process.platform,
      message: '无法获取精确的窗口位置信息，可能需要额外的权限'
    };
    
  } catch (error) {
    console.error('获取窗口详情失败:', error);
    return null;
  }
});

// 初始化全局鼠标监听
ipcMain.handle('start-global-mouse-listening', async () => {
  try {
    if (globalMouseListening) {
      console.log('[全局鼠标] 监听已经启动');
      return { success: true, message: '监听已启动' };
    }

    // 确保robotjs可用
    if (!robot) {
      return { success: false, message: 'robotjs不可用' };
    }

    globalMouseListening = true;
    
    // 获取初始鼠标位置
    const initialPos = robot.getMousePos();
    lastMousePosition = { x: initialPos.x, y: initialPos.y };
    
    console.log('[全局鼠标] 开始监听，初始位置:', lastMousePosition);

    // 启动鼠标位置监听循环
    mouseListenerInterval = setInterval(() => {
      if (!globalMouseListening) return;

      try {
        const currentPos = robot.getMousePos();
        
        // 检查位置是否改变
        if (currentPos.x !== lastMousePosition.x || currentPos.y !== lastMousePosition.y) {
          // 发送鼠标移动事件到渲染进程
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('global-mouse-move', {
              x: currentPos.x,
              y: currentPos.y,
              previousX: lastMousePosition.x,
              previousY: lastMousePosition.y,
              timestamp: Date.now()
            });
          }
          
          lastMousePosition = { x: currentPos.x, y: currentPos.y };
        }
      } catch (error) {
        console.error('[全局鼠标] 位置监听错误:', error);
      }
    }, 8); // 8ms间隔，约120fps

    return { success: true, message: '全局鼠标监听已启动' };
    
  } catch (error) {
    console.error('[全局鼠标] 启动失败:', error);
    return { success: false, message: error.message };
  }
});

// 停止全局鼠标监听
ipcMain.handle('stop-global-mouse-listening', async () => {
  try {
    if (!globalMouseListening) {
      return { success: true, message: '监听未启动' };
    }

    globalMouseListening = false;
    
    if (mouseListenerInterval) {
      clearInterval(mouseListenerInterval);
      mouseListenerInterval = null;
    }

    console.log('[全局鼠标] 监听已停止');
    return { success: true, message: '全局鼠标监听已停止' };
    
  } catch (error) {
    console.error('[全局鼠标] 停止失败:', error);
    return { success: false, message: error.message };
  }
});

// 设置全局鼠标事件监听（使用屏幕外监听技巧）
ipcMain.handle('setup-global-mouse-events', async () => {
  try {
    if (process.platform === 'darwin') {
      // macOS上使用AppleScript定期检查鼠标按键状态
      if (mainWindow && !mainWindow.isDestroyed()) {
        // 注册窗口失去焦点时的全局鼠标监听
        const { globalShortcut } = require('electron');
        
        // 使用不常用的快捷键组合来监听鼠标事件
        // 这是一个变通方案，实际应用中可能需要更好的解决方案
        try {
          // 监听特殊按键组合（如Command+Option+F19等）作为鼠标事件触发器
          // 这里我们采用不同的策略：使用主窗口的鼠标事件
          
          // 启用窗口的鼠标穿透监听
          mainWindow.setIgnoreMouseEvents(false);
          
          // 监听窗口级别的鼠标事件
          mainWindow.webContents.setWindowOpenHandler(() => {
            return { action: 'deny' };
          });
          
          console.log('[全局鼠标] macOS全局鼠标事件监听已设置');
        } catch (shortcutError) {
          console.warn('[全局鼠标] 快捷键注册失败:', shortcutError.message);
        }
      }
    } else if (process.platform === 'win32') {
      // Windows上可能需要不同的处理方式
      console.log('[全局鼠标] Windows平台暂不支持全局鼠标按键监听');
    } else {
      // Linux平台
      console.log('[全局鼠标] Linux平台暂不支持全局鼠标按键监听');
    }

    return { success: true, message: '全局鼠标事件监听已设置' };
    
  } catch (error) {
    console.error('[全局鼠标] 事件设置失败:', error);
    return { success: false, message: error.message };
  }
});

// 隐藏/显示系统光标
ipcMain.handle('toggle-system-cursor', async (event, hide = true) => {
  try {
    if (process.platform === 'darwin') {
      // macOS: 使用AppleScript隐藏光标
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      if (hide) {
        // 隐藏光标的AppleScript
        await execPromise(`
          osascript -e '
            tell application "System Events"
              -- 这里可能需要其他方法来隐藏光标
              -- macOS没有直接的API来隐藏系统光标
            end tell
          '
        `);
      } else {
        // 显示光标
        // 光标通常会在鼠标移动时自动显示
      }
    }
    
    // 通知渲染进程更新光标状态
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cursor-visibility-changed', { hidden: hide });
    }
    
    return { success: true, hidden: hide };
    
  } catch (error) {
    console.error('[光标控制] 失败:', error);
    return { success: false, message: error.message };
  }
});

// 获取当前鼠标位置
ipcMain.handle('get-current-mouse-position', async () => {
  try {
    if (!robot) {
      return { success: false, message: 'robotjs不可用' };
    }
    
    const pos = robot.getMousePos();
    return { 
      success: true, 
      position: { x: pos.x, y: pos.y },
      timestamp: Date.now()
    };
    
  } catch (error) {
    console.error('[鼠标位置] 获取失败:', error);
    return { success: false, message: error.message };
  }
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
