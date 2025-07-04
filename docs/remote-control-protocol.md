# 远程控制二进制协议规范

## 概述
远程控制系统使用高效的二进制协议来传输鼠标和键盘指令，相比JSON格式可减少50-70%的传输开销。

## 协议格式

### 通用头部
```
[2字节 messageType] [2字节 commandType] [2字节 flags] [变长数据]
```

### 消息类型
- **0x10** - REMOTE_CONTROL_COMMAND

### 指令类型

#### 鼠标事件 (0x01-0x0F)
| 指令码 | 名称 | 描述 |
|--------|------|------|
| 0x01 | MOUSE_MOVE | 鼠标移动 |
| 0x02 | MOUSE_DRAG | 鼠标拖拽 |
| 0x03 | MOUSE_DOWN | 鼠标按下 |
| 0x04 | MOUSE_UP | 鼠标释放 |
| 0x05 | MOUSE_CLICK | 鼠标点击 |
| 0x06 | DOUBLE_CLICK | 双击 |
| 0x07 | CONTEXT_MENU | 右键菜单 |
| 0x08 | LONG_PRESS | 长按 |
| 0x09 | SCROLL | 滚轮滚动 |

#### 键盘事件 (0x10-0x1F)
| 指令码 | 名称 | 描述 |
|--------|------|------|
| 0x10 | KEY_DOWN | 按键按下 |
| 0x11 | KEY_UP | 按键释放 |
| 0x12 | KEY_PRESS | 按键按下+释放 |
| 0x13 | KEY_TYPE | 文本输入 |
| 0x14 | SHORTCUT | 快捷键组合 |
| 0x15 | FUNCTION_KEY | 功能键 |

### 标志位定义
| 位 | 标志名 | 描述 |
|----|--------|------|
| 0x01 | HAS_COORDINATES | 包含坐标信息 |
| 0x02 | HAS_BUTTON | 包含按键信息 |
| 0x04 | HAS_KEY | 包含按键名称 |
| 0x08 | HAS_TEXT | 包含文本内容 |
| 0x10 | HAS_MODIFIERS | 包含修饰键 |
| 0x20 | HAS_PLATFORM | 包含平台信息 |
| 0x40 | HAS_VIDEO_RESOLUTION | 包含视频分辨率 |
| 0x80 | HAS_SCREEN_INFO | 包含屏幕信息 |

### 数据字段编码

#### 坐标 (8字节)
```
[4字节 x坐标] [4字节 y坐标] (32位整数，小端序)
```

#### 按键类型 (1字节)
- 0x01 - 左键
- 0x02 - 中键  
- 0x03 - 右键

#### 修饰键 (1字节)
- 0x01 - Ctrl
- 0x02 - Alt
- 0x04 - Shift
- 0x08 - Meta (Cmd/Win)

#### 字符串 (变长)
```
[2字节 长度] [UTF-8字节数据]
```

## 性能优势

### 消息大小对比
| 指令类型 | JSON格式 | 二进制格式 | 节省比例 |
|----------|----------|------------|----------|
| 鼠标移动 | ~120字节 | 30字节 | 75% |
| 键盘按下 | ~90字节 | 25字节 | 72% |
| 文本输入 | ~80字节 + 文本 | 15字节 + 文本 | 81% |

### 其他优势
- ✅ 避免JSON序列化/反序列化开销
- ✅ 减少网络传输延迟
- ✅ 降低CPU使用率
- ✅ 固定字段位置，解析更快
- ✅ 向后兼容JSON格式

## 使用示例

### 鼠标移动指令
```
原始指令:
{
  type: 'mousemove',
  x: 100,
  y: 200,
  clientPlatform: 'win32',
  videoResolution: { width: 1920, height: 1080 }
}

二进制编码 (26字节):
[10 00] [01 00] [61 00] [64 00 00 00] [C8 00 00 00] [05 00] [77 69 6E 33 32] [80 07 00 00] [38 04 00 00]
```

### 按键指令
```
原始指令:
{
  type: 'keydown',
  key: 'a',
  ctrlKey: true,
  clientPlatform: 'darwin'
}

二进制编码 (18字节):
[10 00] [10 00] [34 00] [01 00] [61] [01] [06 00] [64 61 72 77 69 6E]
```

## 实现特性

### 自动启用
二进制协议在新版本中**自动启用**，无需额外配置。

### 故障转移
如果二进制编码失败，系统会自动回退到JSON格式，确保兼容性。

### 自动检测
接收端会自动检测消息格式（二进制 vs JSON）并使用相应的解析器。

## 调试信息
在浏览器控制台中可以看到相关日志：
```
[控制协议] 编码指令: mousemove
[控制协议] 编码完成，大小: 30字节 (原JSON约120字节)
[控制协议] 解码二进制消息，大小: 30字节
[控制协议] 解码完成: mousemove
``` 