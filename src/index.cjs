const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, systemPreferences, shell } = require('electron');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');

// 信令服务器
let signalServer;

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
    
    return sources.map(source => {
      let screenInfo = null;
      
      // 如果是屏幕源，查找对应的显示器信息
      if (source.id.startsWith('screen:')) {
        // 提取屏幕ID (格式通常是 "screen:0:0" 或类似)
        const screenMatch = source.id.match(/screen:(\d+)/);
        if (screenMatch) {
          const screenIndex = parseInt(screenMatch[1]);
          const display = allDisplays[screenIndex];
          if (display) {
            screenInfo = {
              bounds: display.bounds,          // { x, y, width, height }
              workArea: display.workArea,      // 工作区域
              scaleFactor: display.scaleFactor, // 缩放因子
              isPrimary: display.id === screen.getPrimaryDisplay().id
            };
          }
        }
      }
      
      return {
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        screenInfo: screenInfo  // 新增屏幕信息
      };
    });
  } catch (error) {
    console.error('获取桌面源失败:', error);
    return [];
  }
});

// 远程控制事件处理
ipcMain.on('remote-control', (event, data) => {
  try {
    let robot;
    try {
      robot = require('robotjs');
    } catch (error) {
      console.error('RobotJS 不可用:', error.message);
      return;
    }

    // 设置鼠标速度
    robot.setMouseDelay(2);
    robot.setKeyboardDelay(10);

    console.log('[远程控制] 执行命令:', data.type);

    switch (data.type) {
      case 'mousemove':
        if (typeof data.x === 'number' && typeof data.y === 'number') {
          let actualX = data.x;
          let actualY = data.y;
          
          // 如果有屏幕信息，计算实际的全局坐标
          if (data.screenInfo && data.screenInfo.bounds) {
            const bounds = data.screenInfo.bounds;
            actualX = bounds.x + data.x;
            actualY = bounds.y + data.y;
            console.log(`[多屏幕] 原始坐标: (${data.x}, ${data.y}), 屏幕偏移: (${bounds.x}, ${bounds.y}), 实际坐标: (${actualX}, ${actualY})`);
          }
          
          robot.moveMouse(Math.round(actualX), Math.round(actualY));
        }
        break;

      case 'mouseclick':
        // 对于点击，需要先移动到正确位置再点击
        if (data.x !== undefined && data.y !== undefined) {
          let actualX = data.x;
          let actualY = data.y;
          
          if (data.screenInfo && data.screenInfo.bounds) {
            const bounds = data.screenInfo.bounds;
            actualX = bounds.x + data.x;
            actualY = bounds.y + data.y;
          }
          
          robot.moveMouse(Math.round(actualX), Math.round(actualY));
        }
        robot.mouseClick(data.button || 'left', data.double || false);
        break;

      case 'mousedown':
        // 对于鼠标按下，也需要考虑位置
        if (data.x !== undefined && data.y !== undefined) {
          let actualX = data.x;
          let actualY = data.y;
          
          if (data.screenInfo && data.screenInfo.bounds) {
            const bounds = data.screenInfo.bounds;
            actualX = bounds.x + data.x;
            actualY = bounds.y + data.y;
          }
          
          robot.moveMouse(Math.round(actualX), Math.round(actualY));
        }
        robot.mouseToggle('down', data.button || 'left');
        break;

      case 'mouseup':
        robot.mouseToggle('up', data.button || 'left');
        break;

      case 'scroll':
        if (typeof data.x === 'number' || typeof data.y === 'number') {
          robot.scrollMouse(Math.round(data.x || 0), Math.round(data.y || 0));
        }
        break;

      case 'keypress':
        if (data.key) {
          robot.keyTap(data.key, data.modifiers || []);
        }
        break;

      case 'keydown':
        if (data.key) {
          robot.keyToggle(data.key, 'down', data.modifiers || []);
        }
        break;

      case 'keyup':
        if (data.key) {
          robot.keyToggle(data.key, 'up', data.modifiers || []);
        }
        break;

      default:
        console.warn('[远程控制] 未知命令类型:', data.type);
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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  // 创建主窗口
  createWindow();

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
});

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
});
