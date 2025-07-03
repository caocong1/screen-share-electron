/**
 * nut.js Worker 线程 - 处理远程控制操作
 * 避免在主线程中执行nut.js操作，提高响应性能
 */

const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require('worker_threads');

if (isMainThread) {
  throw new Error('此文件应该作为worker线程运行');
}

let mouse, keyboard, Point, Key, Button, sleep, straightTo;
try {
  const nut = require('@nut-tree/nut-js');

  // 在nut.js v4中，需要通过providerRegistry获取实际的操作对象
  mouse = nut.mouse.providerRegistry.getMouse();
  keyboard = nut.keyboard.providerRegistry.getKeyboard();
  Point = nut.Point;
  Key = nut.Key;
  Button = nut.Button;
  sleep = nut.sleep;
  straightTo = nut.straightTo; // 用于鼠标移动路径

  // 验证nut.js对象是否正确初始化
  if (!mouse || !keyboard || !Point || !Key || !Button) {
    throw new Error('Nut.js 对象初始化不完整');
  }

  // 验证mouse对象的方法是否存在
  if (
    typeof mouse.leftClick !== 'function' ||
    typeof mouse.rightClick !== 'function' ||
    typeof mouse.middleClick !== 'function' ||
    typeof mouse.setMousePosition !== 'function'
  ) {
    throw new Error('Mouse 对象方法不完整');
  }

  // 优化nut.js性能设置
  nut.mouse.config.mouseSpeed = 1000; // 鼠标移动速度
  nut.keyboard.config.autoDelayMs = 5; // 键盘延迟

  console.log('[Nut Worker] Nut.js 初始化成功');
} catch (error) {
  console.error('[Nut Worker] Nut.js 不可用:', error.message);
  parentPort.postMessage({
    type: 'error',
    message: `Nut.js 初始化失败: ${error.message}`,
  });
  process.exit(1);
}

// 鼠标移动防抖优化
const mouseMoveBuffer = {
  queue: [],
  timer: null,
  maxBatchSize: 5,
  batchDelay: 4, // 4ms批处理延迟
  lastProcessTime: 0,
};

/**
 * 处理鼠标移动的批量优化
 */
async function processPendingMouseMoves() {
  if (mouseMoveBuffer.queue.length === 0) return;

  // 只处理最新的坐标，丢弃中间的坐标
  const latestMove = mouseMoveBuffer.queue[mouseMoveBuffer.queue.length - 1];
  mouseMoveBuffer.queue = [];

  // 执行实际的鼠标移动
  try {
    const coords = transformCoordinates(latestMove.data);
    await mouse.setMousePosition(new Point(coords.x, coords.y));
    mouseMoveBuffer.lastProcessTime = Date.now();

    // 发送处理完成确认
    parentPort.postMessage({
      type: 'processed',
      originalType: latestMove.data.type,
      coords: coords,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('[Nut Worker] 鼠标移动失败:', error);
  }
}

/**
 * 添加鼠标移动到队列
 */
function addMouseMoveToQueue(data) {
  mouseMoveBuffer.queue.push({ data, timestamp: Date.now() });

  // 如果队列太长，只保留最新的几个
  if (mouseMoveBuffer.queue.length > mouseMoveBuffer.maxBatchSize) {
    mouseMoveBuffer.queue = mouseMoveBuffer.queue.slice(
      -mouseMoveBuffer.maxBatchSize,
    );
  }

  // 设置或重置处理定时器
  if (mouseMoveBuffer.timer) {
    clearTimeout(mouseMoveBuffer.timer);
  }

  mouseMoveBuffer.timer = setTimeout(() => {
    processPendingMouseMoves();
    mouseMoveBuffer.timer = null;
  }, mouseMoveBuffer.batchDelay);
}

/**
 * 坐标转换函数（从主线程复制）
 */
function transformCoordinates(data) {
  let actualX = data.x;
  let actualY = data.y;

  // 如果有视频分辨率信息，进行精确的坐标映射
  if (data.videoResolution && data.screenInfo && data.screenInfo.bounds) {
    const bounds = data.screenInfo.bounds;
    const scaleFactor = data.screenInfo.scaleFactor || 1;
    const clientPlatform = data.clientPlatform || 'unknown';
    const videoWidth = data.videoResolution.width;
    const videoHeight = data.videoResolution.height;

    // 核心坐标转换逻辑
    if (process.platform === 'darwin' && scaleFactor > 1) {
      // macOS接收端，需要考虑Retina缩放
      if (clientPlatform === 'win32') {
        // Windows -> macOS: 需要考虑视频分辨率和实际屏幕分辨率的映射
        const scaleX = bounds.width / videoWidth;
        const scaleY = bounds.height / videoHeight;
        actualX = bounds.x + data.x * scaleX;
        actualY = bounds.y + data.y * scaleY;
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
        actualX = bounds.x + relativeX * bounds.width * scaleFactor;
        actualY = bounds.y + relativeY * bounds.height * scaleFactor;
      } else {
        // Windows -> Windows: 直接映射
        actualX = bounds.x + data.x;
        actualY = bounds.y + data.y;
      }
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
 * 完整的键盘映射表
 * 映射浏览器键盘事件到Nut.js Key枚举
 */
function getKeyMap() {
  return {
    // 功能键
    Escape: Key.Escape,
    F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4,
    F5: Key.F5, F6: Key.F6, F7: Key.F7, F8: Key.F8,
    F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
    F13: Key.F13, F14: Key.F14, F15: Key.F15, F16: Key.F16,
    F17: Key.F17, F18: Key.F18, F19: Key.F19, F20: Key.F20,
    F21: Key.F21, F22: Key.F22, F23: Key.F23, F24: Key.F24,
    Print: Key.Print,
    ScrollLock: Key.ScrollLock,
    Pause: Key.Pause,
    
    // 数字键行
    '`': Key.Grave,
    '1': Key.Num1, '2': Key.Num2, '3': Key.Num3, '4': Key.Num4, '5': Key.Num5,
    '6': Key.Num6, '7': Key.Num7, '8': Key.Num8, '9': Key.Num9, '0': Key.Num0,
    '-': Key.Minus, '=': Key.Equal,
    Backspace: Key.Backspace,
    
    // 编辑键
    Insert: Key.Insert,
    Home: Key.Home,
    PageUp: Key.PageUp,
    Delete: Key.Delete,
    End: Key.End,
    PageDown: Key.PageDown,
    
    // 数字键盘
    NumLock: Key.NumLock,
    '/': Key.Divide,
    '*': Key.Multiply,
    '+': Key.Add,
    'Divide': Key.Divide,
    'Subtract': Key.Subtract,
    'Numpad7': Key.NumPad7, 'Numpad8': Key.NumPad8, 'Numpad9': Key.NumPad9,
    'Numpad4': Key.NumPad4, 'Numpad5': Key.NumPad5, 'Numpad6': Key.NumPad6,
    'Numpad1': Key.NumPad1, 'Numpad2': Key.NumPad2, 'Numpad3': Key.NumPad3,
    'Numpad0': Key.NumPad0, 'NumpadDecimal': Key.Decimal,
    Clear: Key.Clear,
    
    // 字母键
    Tab: Key.Tab,
    'q': Key.Q, 'w': Key.W, 'e': Key.E, 'r': Key.R, 't': Key.T,
    'y': Key.Y, 'u': Key.U, 'i': Key.I, 'o': Key.O, 'p': Key.P,
    '[': Key.LeftBracket, ']': Key.RightBracket, '\\': Key.Backslash,
    
    CapsLock: Key.CapsLock,
    'a': Key.A, 's': Key.S, 'd': Key.D, 'f': Key.F, 'g': Key.G,
    'h': Key.H, 'j': Key.J, 'k': Key.K, 'l': Key.L,
    ';': Key.Semicolon, "'": Key.Quote,
    Enter: Key.Enter,
    
    // 修饰键
    Shift: Key.LeftShift,
    'z': Key.Z, 'x': Key.X, 'c': Key.C, 'v': Key.V, 'b': Key.B,
    'n': Key.N, 'm': Key.M, ',': Key.Comma, '.': Key.Period, '/': Key.Slash,
    RightShift: Key.RightShift,
    
    // 控制键
    Control: Key.LeftControl,
    Alt: Key.LeftAlt,
    Meta: process.platform === 'darwin' ? Key.LeftCmd : Key.LeftSuper,
    Space: Key.Space,
    RightAlt: Key.RightAlt,
    RightSuper: process.platform === 'darwin' ? Key.RightCmd : Key.RightSuper,
    Menu: Key.Menu,
    RightControl: Key.RightControl,
    Fn: Key.Fn,
    
    // 方向键
    ArrowUp: Key.Up,
    ArrowDown: Key.Down,
    ArrowLeft: Key.Left,
    ArrowRight: Key.Right,
    
    // 音频控制键
    AudioMute: Key.AudioMute,
    AudioVolDown: Key.AudioVolDown,
    AudioVolUp: Key.AudioVolUp,
    AudioPlay: Key.AudioPlay,
    AudioStop: Key.AudioStop,
    AudioPause: Key.AudioPause,
    AudioPrev: Key.AudioPrev,
    AudioNext: Key.AudioNext,
    AudioRewind: Key.AudioRewind,
    AudioForward: Key.AudioForward,
    AudioRepeat: Key.AudioRepeat,
    AudioRandom: Key.AudioRandom,
    
    // 特殊键映射
    'Return': Key.Return,
    'LeftWin': Key.LeftWin,
    'LeftCmd': Key.LeftCmd,
    'RightWin': Key.RightWin,
    'RightCmd': Key.RightCmd,
    
    // 额外的浏览器键盘事件映射
    'ContextMenu': Key.Menu,
    'NumLock': Key.NumLock,
    'ScrollLock': Key.ScrollLock,
    'Pause': Key.Pause,
    'PrintScreen': Key.Print,
    'Insert': Key.Insert,
    'Home': Key.Home,
    'PageUp': Key.PageUp,
    'PageDown': Key.PageDown,
    'End': Key.End,
    'Delete': Key.Delete,
    'Backspace': Key.Backspace,
    'Tab': Key.Tab,
    'Enter': Key.Enter,
    'Escape': Key.Escape,
    'Space': Key.Space,
    'CapsLock': Key.CapsLock,
    'Shift': Key.LeftShift,
    'Control': Key.LeftControl,
    'Alt': Key.LeftAlt,
    'Meta': process.platform === 'darwin' ? Key.LeftCmd : Key.LeftSuper,
    
    // 方向键的替代名称
    'Up': Key.Up,
    'Down': Key.Down,
    'Left': Key.Left,
    'Right': Key.Right,
    
    // 功能键的替代名称
    'F1': Key.F1, 'F2': Key.F2, 'F3': Key.F3, 'F4': Key.F4,
    'F5': Key.F5, 'F6': Key.F6, 'F7': Key.F7, 'F8': Key.F8,
    'F9': Key.F9, 'F10': Key.F10, 'F11': Key.F11, 'F12': Key.F12,
    'F13': Key.F13, 'F14': Key.F14, 'F15': Key.F15, 'F16': Key.F16,
    'F17': Key.F17, 'F18': Key.F18, 'F19': Key.F19, 'F20': Key.F20,
    'F21': Key.F21, 'F22': Key.F22, 'F23': Key.F23, 'F24': Key.F24,
  };
}

/**
 * 主要的消息处理器
 */
parentPort.on('message', async (message) => {
  let data = null; // 在外部声明data变量，确保在catch块中可用

  try {
    const { type, data: messageData } = message;
    data = messageData; // 赋值给外部变量

    // 处理远程控制命令
    switch (data.type) {
      case 'mousemove':
      case 'mousedrag':
        // 使用批量处理优化鼠标移动
        addMouseMoveToQueue(data);
        break;

      case 'mousedown': {
        console.log('[Nut Worker] 收到鼠标按下事件:', {
          data: data,
          hasCoords: data.x !== undefined && data.y !== undefined,
          button: data.button,
          source: data.source,
          isDragging: data.isDragging,
        });

        // 鼠标按下需要立即处理
        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          console.log('[Nut Worker] 坐标转换结果:', {
            原始: { x: data.x, y: data.y },
            转换后: coords,
          });
          await mouse.setMousePosition(new Point(coords.x, coords.y));
        }
        // 映射按键值：0=left, 1=middle, 2=right 或 'left'='middle'='right'
        const downButton = (() => {
          if (typeof data.button === 'number') {
            return data.button === 0 ? Button.LEFT : data.button === 1 ? Button.MIDDLE : Button.RIGHT;
          } else if (typeof data.button === 'string') {
            return data.button === 'left' ? Button.LEFT : data.button === 'middle' ? Button.MIDDLE : Button.RIGHT;
          }
          return Button.LEFT; // 默认左键
        })();
        await mouse.pressButton(downButton);
        console.log('[Nut Worker] 鼠标按下成功:', {
          button: data.button,
          mapped: downButton,
        });
        break;
      }

      case 'mouseup': {
        console.log('[Nut Worker] 收到鼠标释放事件:', {
          data: data,
          hasCoords: data.x !== undefined && data.y !== undefined,
          button: data.button,
          source: data.source,
        });

        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          console.log('[Nut Worker] 坐标转换结果:', {
            原始: { x: data.x, y: data.y },
            转换后: coords,
          });
          await mouse.setMousePosition(new Point(coords.x, coords.y));
        }
        // 映射按键值：0=left, 1=middle, 2=right 或 'left'='middle'='right'
        const upButton = (() => {
          if (typeof data.button === 'number') {
            return data.button === 0 ? Button.LEFT : data.button === 1 ? Button.MIDDLE : Button.RIGHT;
          } else if (typeof data.button === 'string') {
            return data.button === 'left' ? Button.LEFT : data.button === 'middle' ? Button.MIDDLE : Button.RIGHT;
          }
          return Button.LEFT; // 默认左键
        })();
        await mouse.releaseButton(upButton);
        console.log('[Nut Worker] 鼠标释放成功:', {
          button: data.button,
          mapped: upButton,
        });
        break;
      }

      case 'doubleclick': {
        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          await mouse.setMousePosition(new Point(coords.x, coords.y));
        }
        // 映射按键值：0=left, 1=middle, 2=right 或 'left'='middle'='right'
        const dblClickButton = (() => {
          if (typeof data.button === 'number') {
            return data.button === 0 ? Button.LEFT : data.button === 1 ? Button.MIDDLE : Button.RIGHT;
          } else if (typeof data.button === 'string') {
            return data.button === 'left' ? Button.LEFT : data.button === 'middle' ? Button.MIDDLE : Button.RIGHT;
          }
          return Button.LEFT; // 默认左键
        })();
        await mouse.doubleClick(dblClickButton);
        console.log('[Nut Worker] 双击:', {
          button: data.button,
          mapped: dblClickButton,
        });
        break;
      }

      case 'contextmenu':
        console.log('[Nut Worker] 收到右键菜单事件:', {
          data: data,
          hasCoords: data.x !== undefined && data.y !== undefined,
          button: data.button,
          source: data.source,
        });

        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          console.log('[Nut Worker] 坐标转换结果:', {
            原始: { x: data.x, y: data.y },
            转换后: coords,
          });
          await mouse.setMousePosition(new Point(coords.x, coords.y));
        }
        await mouse.rightClick();
        console.log('[Nut Worker] 右键菜单执行成功');
        break;

      case 'longpress': {
        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          await mouse.setMousePosition(new Point(coords.x, coords.y));
        }
        // 映射按键值：0=left, 1=middle, 2=right 或 'left'='middle'='right'
        const longPressButton = (() => {
          if (typeof data.button === 'number') {
            return data.button === 0 ? Button.LEFT : data.button === 1 ? Button.MIDDLE : Button.RIGHT;
          } else if (typeof data.button === 'string') {
            return data.button === 'left' ? Button.LEFT : data.button === 'middle' ? Button.MIDDLE : Button.RIGHT;
          }
          return Button.LEFT; // 默认左键
        })();
        await mouse.pressButton(longPressButton);
        console.log('[Nut Worker] 长按开始:', {
          button: data.button,
          mapped: longPressButton,
        });
        setTimeout(async () => {
          await mouse.releaseButton(longPressButton);
          console.log('[Nut Worker] 长按结束:', { mapped: longPressButton });
        }, 100);
        break;
      }

      case 'scroll': {
        console.log('[Nut Worker] 收到滚轮事件:', {
          deltaX: data.deltaX,
          deltaY: data.deltaY,
          deltaMode: data.deltaMode,
          x: data.x,
          y: data.y,
          所有数据: data,
        });

        // 修复滚轮事件处理
        if (
          typeof data.deltaX === 'number' ||
          typeof data.deltaY === 'number'
        ) {
          // 优先使用原始的 deltaX/deltaY 值
          let scrollX = 0;
          let scrollY = 0;

          // 处理 deltaY（垂直滚动）- 大幅增大滚动量以确保效果明显
          if (typeof data.deltaY === 'number' && data.deltaY !== 0) {
            // 根据 deltaMode 调整滚动量，进一步增加倍数
            if (data.deltaMode === 0) {
              // DOM_DELTA_PIXEL - 像素模式，增大滚动量
              scrollY = Math.round(data.deltaY / 2); // 从/3改为/2
            } else if (data.deltaMode === 1) {
              // DOM_DELTA_LINE - 行模式，放大滚动量
              scrollY = Math.round(data.deltaY * 5); // 从*3改为*5
            } else if (data.deltaMode === 2) {
              // DOM_DELTA_PAGE - 页面模式
              scrollY = Math.round(data.deltaY * 30); // 从*20改为*30
            } else {
              scrollY = Math.round(data.deltaY / 2); // 从/3改为/2
            }
          }

          // 处理 deltaX（水平滚动）- 增大滚动量
          if (typeof data.deltaX === 'number' && data.deltaX !== 0) {
            if (data.deltaMode === 0) {
              scrollX = Math.round(data.deltaX / 2); // 从/3改为/2
            } else if (data.deltaMode === 1) {
              scrollX = Math.round(data.deltaX * 5); // 从*3改为*5
            } else if (data.deltaMode === 2) {
              scrollX = Math.round(data.deltaX * 30); // 从*20改为*30
            } else {
              scrollX = Math.round(data.deltaX / 2); // 从/3改为/2
            }
          }

          // 确保最小滚动量 - Windows需要更大的滚动量
          const minScrollAmount = process.platform === 'win32' ? 3 : 1;
          if (scrollX !== 0 && Math.abs(scrollX) < minScrollAmount) {
            scrollX = scrollX > 0 ? minScrollAmount : -minScrollAmount;
          }
          if (scrollY !== 0 && Math.abs(scrollY) < minScrollAmount) {
            scrollY = scrollY > 0 ? minScrollAmount : -minScrollAmount;
          }

          // 执行滚动
          if (scrollX !== 0 || scrollY !== 0) {
            try {
              // Windows平台使用增强的滚动处理
              if (process.platform === 'win32') {
                // 主滚动调用
                if (scrollY > 0) {
                  await mouse.scrollDown(Math.abs(scrollY));
                } else if (scrollY < 0) {
                  await mouse.scrollUp(Math.abs(scrollY));
                }
                if (scrollX > 0) {
                  await mouse.scrollRight(Math.abs(scrollX));
                } else if (scrollX < 0) {
                  await mouse.scrollLeft(Math.abs(scrollX));
                }

                // 额外的增强滚动（如果scrollY较大，分解为多次小滚动）
                if (Math.abs(scrollY) > 3) {
                  const extraSteps = Math.min(
                    Math.floor(Math.abs(scrollY) / 3),
                    3,
                  );
                  const extraDirection = scrollY > 0 ? 1 : -1;
                  for (let i = 0; i < extraSteps; i++) {
                    setTimeout(
                      async () => {
                        if (extraDirection > 0) {
                          await mouse.scrollDown(1);
                        } else {
                          await mouse.scrollUp(1);
                        }
                      },
                      (i + 1) * 15,
                    );
                  }
                }
              } else {
                // 其他平台标准滚动
                if (scrollY > 0) {
                  await mouse.scrollDown(Math.abs(scrollY));
                } else if (scrollY < 0) {
                  await mouse.scrollUp(Math.abs(scrollY));
                }
                if (scrollX > 0) {
                  await mouse.scrollRight(Math.abs(scrollX));
                } else if (scrollX < 0) {
                  await mouse.scrollLeft(Math.abs(scrollX));
                }
              }

              console.log('[Nut Worker] 滚轮操作成功:', {
                原始: {
                  deltaX: data.deltaX,
                  deltaY: data.deltaY,
                  deltaMode: data.deltaMode,
                },
                处理后: { scrollX, scrollY },
                平台: process.platform,
                增强处理: process.platform === 'win32' && Math.abs(scrollY) > 3,
                执行结果: '已调用nut.js滚轮方法',
              });
            } catch (error) {
              console.error('[Nut Worker] 滚轮操作失败:', error);
            }
          } else {
            console.log('[Nut Worker] 滚轮操作跳过:', {
              原始: {
                deltaX: data.deltaX,
                deltaY: data.deltaY,
                deltaMode: data.deltaMode,
              },
              原因: 'scrollX和scrollY都为0',
            });
          }
        } else if (typeof data.x === 'number' || typeof data.y === 'number') {
          // 兜底逻辑：使用处理过的 x/y 值，大幅增大滚动量
          let fallbackX = Math.round((data.x || 0) * 20); // 大幅增大倍数
          let fallbackY = Math.round((data.y || 0) * 20); // 大幅增大倍数

          // 确保最小滚动量 - Windows需要更大的滚动量
          const minScroll = process.platform === 'win32' ? 5 : 3;
          if (fallbackX !== 0 && Math.abs(fallbackX) < minScroll) {
            fallbackX = fallbackX > 0 ? minScroll : -minScroll;
          }
          if (fallbackY !== 0 && Math.abs(fallbackY) < minScroll) {
            fallbackY = fallbackY > 0 ? minScroll : -minScroll;
          }

          try {
            // Windows平台尝试多种滚动方式
            if (process.platform === 'win32') {
              // 方法1：标准滚动
              if (fallbackY > 0) {
                await mouse.scrollDown(Math.abs(fallbackY));
              } else if (fallbackY < 0) {
                await mouse.scrollUp(Math.abs(fallbackY));
              }
              if (fallbackX > 0) {
                await mouse.scrollRight(Math.abs(fallbackX));
              } else if (fallbackX < 0) {
                await mouse.scrollLeft(Math.abs(fallbackX));
              }

              // 方法2：如果标准滚动效果不明显，尝试多次小幅滚动
              if (Math.abs(fallbackY) > 0) {
                const steps = Math.abs(fallbackY);
                const direction = fallbackY > 0 ? 1 : -1;
                for (let i = 0; i < Math.min(steps, 5); i++) {
                  setTimeout(async () => {
                    if (direction > 0) {
                      await mouse.scrollDown(1);
                    } else {
                      await mouse.scrollUp(1);
                    }
                  }, i * 10);
                }
              }
            } else {
              // 其他平台使用标准滚动
              if (fallbackY > 0) {
                await mouse.scrollDown(Math.abs(fallbackY));
              } else if (fallbackY < 0) {
                await mouse.scrollUp(Math.abs(fallbackY));
              }
              if (fallbackX > 0) {
                await mouse.scrollRight(Math.abs(fallbackX));
              } else if (fallbackX < 0) {
                await mouse.scrollLeft(Math.abs(fallbackX));
              }
            }

            console.log('[Nut Worker] 滚轮兜底处理:', {
              使用兜底逻辑: true,
              原始x: data.x,
              原始y: data.y,
              处理后: { fallbackX, fallbackY },
              平台: process.platform,
              特殊处理: process.platform === 'win32' ? '多次滚动' : '标准滚动',
              执行结果: '已调用nut.js滚轮方法',
            });
          } catch (error) {
            console.error('[Nut Worker] 滚轮兜底操作失败:', error);
          }
        } else {
          console.log('[Nut Worker] 滚轮事件无数据:', {
            data: data,
            错误: '没有可用的滚轮数据',
          });
        }
        break;
      }

      case 'gesturestart':
      case 'gesturechange':
      case 'gestureend':
        // 触摸板手势事件 - 可以转换为相应的系统手势或快捷键
        // 例如，双指缩放可以转换为Ctrl+滚轮
        if (data.scale && data.scale !== 1) {
          const scaleDirection = data.scale > 1 ? -1 : 1; // 放大时向上滚动，缩小时向下滚动
          const scrollAmount = Math.abs(data.scale - 1) * 5; // 根据缩放比例调整滚动量

          // 模拟Ctrl+滚轮进行缩放
          await keyboard.pressKey(Key.LeftControl);
          if (scaleDirection > 0) {
            await mouse.scrollUp(Math.round(scrollAmount));
          } else {
            await mouse.scrollDown(Math.round(scrollAmount));
          }
          await keyboard.releaseKey(Key.LeftControl);
        }
        break;

      case 'touchstart':
        // 触摸开始 - 模拟鼠标按下
        if (data.x !== undefined && data.y !== undefined) {
          const coords = transformCoordinates(data);
          await mouse.setMousePosition(new Point(coords.x, coords.y));
        }
        // 单点触摸模拟左键，多点触摸可以有不同处理
        if (data.touchCount === 1) {
          await mouse.pressButton(Button.LEFT);
        } else if (data.touchCount === 2) {
          // 双指触摸可以模拟右键
          await mouse.pressButton(Button.RIGHT);
        }
        break;

      case 'touchmove':
        // 触摸移动 - 模拟鼠标拖拽
        if (data.touchCount === 1) {
          // 单点触摸作为鼠标移动
          addMouseMoveToQueue(data);
        }
        // 多点触摸可以处理为手势
        break;

      case 'touchend':
        // 触摸结束 - 模拟鼠标释放
        if (data.touchCount <= 1) {
          await mouse.releaseButton(Button.LEFT);
        } else if (data.touchCount === 2) {
          await mouse.releaseButton(Button.RIGHT);
        }
        break;

      case 'keydown':
        console.log('[Nut Worker] 收到keydown事件:', {
          data: data,
          hasKey: !!data.key,
          key: data.key,
          code: data.code,
          modifiers: {
            ctrl: data.ctrlKey,
            alt: data.altKey,
            shift: data.shiftKey,
            meta: data.metaKey,
          },
          source: data.source,
          platform: data.clientPlatform,
          nutjsKeyboardAvailable: !!keyboard,
        });

        if (data.key) {
          const modifiers = [];
          if (data.ctrlKey) modifiers.push(Key.LeftControl);
          if (data.altKey) modifiers.push(Key.LeftAlt);
          if (data.shiftKey) modifiers.push(Key.LeftShift);
          if (data.metaKey)
            modifiers.push(
              process.platform === 'darwin' ? Key.LeftCmd : Key.LeftMeta,
            );

          const keyMap = getKeyMap();
          const nutKey = keyMap[data.key] || data.key;

          console.log('[Nut Worker] 键位映射:', {
            原始key: data.key,
            映射后: nutKey,
            修饰键:
              modifiers.length > 0 ? modifiers.map((m) => m.toString()) : '无',
            键盘API可用: typeof keyboard.pressKey === 'function',
          });

          try {
            if (modifiers.length > 0) {
              console.log('[Nut Worker] 执行带修饰键的按键:', {
                modifiers: modifiers.map((m) => m.toString()),
                mainKey: nutKey,
              });
              await keyboard.pressKey(...modifiers);
              await keyboard.pressKey(nutKey);
              await keyboard.releaseKey(nutKey);
              await keyboard.releaseKey(...modifiers.reverse());
            } else {
              console.log('[Nut Worker] 执行单个按键:', nutKey);
              await keyboard.pressKey(nutKey);
              // 注意：对于keydown事件，我们只按下不释放
              // 释放操作由对应的keyup事件处理
              // 但如果你希望立即完成按键操作，取消注释下一行：
              // await keyboard.releaseKey(nutKey);
            }
            console.log('[Nut Worker] keydown执行成功:', {
              key: data.key,
              nutKey: nutKey,
              hasModifiers: modifiers.length > 0,
            });
          } catch (error) {
            console.error('[Nut Worker] keydown执行失败:', {
              error: error.message,
              key: data.key,
              nutKey: nutKey,
              modifiers:
                modifiers.length > 0
                  ? modifiers.map((m) => m.toString())
                  : '无',
            });
          }
        } else {
          console.warn('[Nut Worker] keydown事件缺少key属性:', data);
        }
        break;

      case 'keyup':
        console.log('[Nut Worker] 收到keyup事件:', {
          data: data,
          hasKey: !!data.key,
          key: data.key,
          nutjsKeyboardAvailable: !!keyboard,
        });

        if (data.key) {
          const keyMap = getKeyMap();
          const nutKey = keyMap[data.key] || data.key;

          console.log('[Nut Worker] keyup键位映射:', {
            原始key: data.key,
            映射后: nutKey,
          });

          try {
            await keyboard.releaseKey(nutKey);
            console.log('[Nut Worker] keyup执行成功:', {
              key: data.key,
              nutKey: nutKey,
            });
          } catch (error) {
            console.error('[Nut Worker] keyup执行失败:', {
              error: error.message,
              key: data.key,
              nutKey: nutKey,
            });
          }
        } else {
          console.warn('[Nut Worker] keyup事件缺少key属性:', data);
        }
        break;

      case 'keypress':
        console.log('[Nut Worker] 收到keypress事件:', {
          data: data,
          hasKey: !!data.key,
          key: data.key,
          modifiers: data.modifiers,
          nutjsKeyboardAvailable: !!keyboard,
        });

        if (data.key) {
          const modifiers = data.modifiers || [];
          const keyModifiers = modifiers.map((mod) => {
            switch (mod) {
              case 'control':
                return Key.LeftControl;
              case 'alt':
                return Key.LeftAlt;
              case 'shift':
                return Key.LeftShift;
              case 'meta':
                return process.platform === 'darwin'
                  ? Key.LeftCmd
                  : Key.LeftMeta;
              default:
                return mod;
            }
          });

          console.log('[Nut Worker] keypress修饰键映射:', {
            原始modifiers: modifiers,
            映射后: keyModifiers.map((m) => (m.toString ? m.toString() : m)),
          });

          try {
            if (keyModifiers.length > 0) {
              await keyboard.pressKey(...keyModifiers);
              await keyboard.pressKey(data.key);
              await keyboard.releaseKey(data.key);
              await keyboard.releaseKey(...keyModifiers.reverse());
            } else {
              await keyboard.pressKey(data.key);
              await keyboard.releaseKey(data.key);
            }
            console.log('[Nut Worker] keypress执行成功:', {
              key: data.key,
              modifiers: keyModifiers.length,
            });
          } catch (error) {
            console.error('[Nut Worker] keypress执行失败:', {
              error: error.message,
              key: data.key,
              modifiers: keyModifiers,
            });
          }
        } else {
          console.warn('[Nut Worker] keypress事件缺少key属性:', data);
        }
        break;

      case 'keytype':
        console.log('[Nut Worker] 收到keytype事件:', {
          data: data,
          hasText: !!data.text,
          text: data.text,
          textLength: data.text ? data.text.length : 0,
          nutjsKeyboardAvailable: !!keyboard,
        });

        if (data.text) {
          try {
            await keyboard.type(data.text);
            console.log('[Nut Worker] keytype执行成功:', {
              text: data.text,
              length: data.text.length,
            });
          } catch (error) {
            console.error('[Nut Worker] keytype执行失败:', {
              error: error.message,
              text: data.text,
            });
          }
        } else {
          console.warn('[Nut Worker] keytype事件缺少text属性:', data);
        }
        break;

      case 'shortcut':
        if (data.key) {
          const modifiers = [];
          if (data.ctrlKey) modifiers.push(Key.LeftControl);
          if (data.altKey) modifiers.push(Key.LeftAlt);
          if (data.shiftKey) modifiers.push(Key.LeftShift);
          if (data.metaKey)
            modifiers.push(
              process.platform === 'darwin' ? Key.LeftCmd : Key.LeftMeta,
            );

          const keyMap = getKeyMap();

          const nutKey =
            keyMap[data.key.toLowerCase()] || data.key.toLowerCase();

          if (modifiers.length > 0) {
            await keyboard.pressKey(...modifiers);
            await keyboard.pressKey(nutKey);
            await keyboard.releaseKey(nutKey);
            await keyboard.releaseKey(...modifiers.reverse());
          } else {
            await keyboard.pressKey(nutKey);
            await keyboard.releaseKey(nutKey);
          }
        }
        break;

      case 'functionkey':
        if (data.key) {
          const keyMap = getKeyMap();
          const nutKey = keyMap[data.key] || data.key;
          await keyboard.pressKey(nutKey);
          await keyboard.releaseKey(nutKey);
        }
        break;

      default:
        console.warn('[Nut Worker] 未知命令类型:', data.type);
    }

    // 发送处理完成确认（除了鼠标移动，那个会在批处理中发送）
    if (data.type !== 'mousemove' && data.type !== 'mousedrag') {
      parentPort.postMessage({
        type: 'processed',
        originalType: data.type,
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    console.error('[Nut Worker] 处理失败:', error);
    parentPort.postMessage({
      type: 'error',
      message: error.message,
      originalType: data?.type,
    });
  }
});

// 发送初始化完成消息
parentPort.postMessage({
  type: 'ready',
  message: 'Nut Worker 已就绪',
  pid: process.pid,
});

console.log('[Nut Worker] 启动完成, PID:', process.pid);
