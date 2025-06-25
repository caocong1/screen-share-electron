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

// 坐标转换辅助函数
function transformCoordinates(data) {
  let actualX = data.x;
  let actualY = data.y;
  
  if (data.screenInfo && data.screenInfo.bounds) {
    const bounds = data.screenInfo.bounds;
    const scaleFactor = data.screenInfo.scaleFactor || 1;
    const clientPlatform = data.clientPlatform || 'unknown';
    
    // 智能坐标转换逻辑
    if (process.platform === 'darwin' && scaleFactor > 1) {
      if (clientPlatform === 'win32') {
        actualX = bounds.x + (data.x / scaleFactor);
        actualY = bounds.y + (data.y / scaleFactor);
      } else {
        actualX = bounds.x + data.x;
        actualY = bounds.y + data.y;
      }
    } else {
      actualX = bounds.x + data.x;
      actualY = bounds.y + data.y;
    }
    
    if (data.type !== 'mousemove' && data.type !== 'mousedrag') {
      console.log(`[坐标转换] 接收端: ${process.platform}, 发送端: ${clientPlatform}, 原始: (${data.x}, ${data.y}), 缩放: ${scaleFactor}, 最终: (${actualX}, ${actualY})`);
    }
  }
  
  return { x: Math.round(actualX), y: Math.round(actualY) };
}

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
      case 'mousedrag':
        if (typeof data.x === 'number' && typeof data.y === 'number') {
          const coords = transformCoordinates(data);
          robot.moveMouse(coords.x, coords.y);
        }
        break;

      case 'mousedown':
        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          robot.moveMouse(coords.x, coords.y);
        }
        robot.mouseToggle('down', data.button || 'left');
        break;

      case 'mouseup':
        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          robot.moveMouse(coords.x, coords.y);
        }
        robot.mouseToggle('up', data.button || 'left');
        break;

      case 'mouseclick':
        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          robot.moveMouse(coords.x, coords.y);
        }
        robot.mouseClick(data.button || 'left', false);
        break;

      case 'doubleclick':
        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          robot.moveMouse(coords.x, coords.y);
        }
        robot.mouseClick(data.button || 'left', true);
        break;

      case 'contextmenu':
        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          robot.moveMouse(coords.x, coords.y);
        }
        robot.mouseClick('right');
        break;

      case 'longpress':
        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          robot.moveMouse(coords.x, coords.y);
        }
        // 长按可以通过按下后延时释放来模拟
        robot.mouseToggle('down', data.button || 'left');
        setTimeout(() => {
          robot.mouseToggle('up', data.button || 'left');
        }, 100);
        break;

      case 'scroll':
        if (typeof data.x === 'number' || typeof data.y === 'number') {
          robot.scrollMouse(Math.round(data.x || 0), Math.round(data.y || 0));
        }
        break;

      case 'keydown':
        if (data.key) {
          // 处理修饰键
          const modifiers = [];
          if (data.ctrlKey) modifiers.push('control');
          if (data.altKey) modifiers.push('alt');
          if (data.shiftKey) modifiers.push('shift');
          if (data.metaKey) modifiers.push(process.platform === 'darwin' ? 'command' : 'meta');
          
          // 键名映射 - RobotJS使用不同的键名
          const keyMap = {
            'ArrowUp': 'up',
            'ArrowDown': 'down',
            'ArrowLeft': 'left',
            'ArrowRight': 'right',
            'Delete': 'delete',
            'Backspace': 'backspace',
            'Enter': 'enter',
            'Tab': 'tab',
            'Escape': 'escape',
            'Space': 'space',
            'CapsLock': 'capslock',
            'Control': 'control',
            'Alt': 'alt',
            'Shift': 'shift',
            'Meta': process.platform === 'darwin' ? 'command' : 'meta'
          };
          
          const robotKey = keyMap[data.key] || data.key.toLowerCase();
          
          if (modifiers.length > 0) {
            robot.keyTap(robotKey, modifiers);
          } else {
            robot.keyToggle(robotKey, 'down');
          }
        }
        break;

      case 'keyup':
        if (data.key) {
          const keyMap = {
            'ArrowUp': 'up',
            'ArrowDown': 'down',
            'ArrowLeft': 'left',
            'ArrowRight': 'right',
            'Delete': 'delete',
            'Backspace': 'backspace',
            'Enter': 'enter',
            'Tab': 'tab',
            'Escape': 'escape',
            'Space': 'space',
            'CapsLock': 'capslock',
            'Control': 'control',
            'Alt': 'alt',
            'Shift': 'shift',
            'Meta': process.platform === 'darwin' ? 'command' : 'meta'
          };
          
          const robotKey = keyMap[data.key] || data.key.toLowerCase();
          robot.keyToggle(robotKey, 'up');
        }
        break;

      case 'keypress':
        if (data.key) {
          robot.keyTap(data.key, data.modifiers || []);
        }
        break;

      case 'keytype':
        // 虚拟键盘文本输入
        if (data.text) {
          robot.typeString(data.text);
        }
        break;

      case 'shortcut':
        // 虚拟键盘快捷键
        if (data.key) {
          const modifiers = [];
          if (data.ctrlKey) modifiers.push('control');
          if (data.altKey) modifiers.push('alt');
          if (data.shiftKey) modifiers.push('shift');
          if (data.metaKey) modifiers.push(process.platform === 'darwin' ? 'command' : 'meta');
          
          // 键名映射
          const keyMap = {
            'c': 'c',
            'v': 'v',
            'x': 'x',
            'z': 'z',
            'y': 'y',
            'a': 'a',
            's': 's',
            'tab': 'tab',
            'esc': 'escape',
            'l': 'l',
            'd': 'd',
            'r': 'r',
            'space': 'space'
          };
          
          const robotKey = keyMap[data.key.toLowerCase()] || data.key.toLowerCase();
          robot.keyTap(robotKey, modifiers);
          console.log(`[远程控制] 执行快捷键: ${modifiers.join('+')}+${robotKey}`);
        }
        break;

      case 'functionkey':
        // 虚拟键盘功能键
        if (data.key) {
          const fKeyMap = {
            'F1': 'f1', 'F2': 'f2', 'F3': 'f3', 'F4': 'f4',
            'F5': 'f5', 'F6': 'f6', 'F7': 'f7', 'F8': 'f8',
            'F9': 'f9', 'F10': 'f10', 'F11': 'f11', 'F12': 'f12'
          };
          
          const robotKey = fKeyMap[data.key] || data.key.toLowerCase();
          robot.keyTap(robotKey);
          console.log(`[远程控制] 执行功能键: ${robotKey}`);
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
