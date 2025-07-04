# 远程控制操作指南

## 🎮 支持的操作

### 鼠标操作

#### 基础操作
- **移动鼠标**：在视频区域移动鼠标，远程端鼠标会同步移动
- **左键点击**：在视频上点击鼠标左键
- **右键点击**：在视频上点击鼠标右键，会弹出右键菜单
- **中键点击**：在视频上点击鼠标中键
- **双击**：快速双击可触发双击事件

#### 高级操作
- **长按**：按住鼠标不松开超过500ms会触发长按事件
- **拖拽**：按住鼠标并移动可进行拖拽操作
  - 支持左键、右键、中键拖拽
  - 拖拽时视频边框会变蓝色显示状态
  - 拖拽结束时会发送完整的拖拽信息
- **滚轮**：使用滚轮可进行页面滚动

### 键盘操作

#### 基础按键
- **字母/数字键**：直接在视频区域获得焦点后输入
- **方向键**：←↑↓→ 导航
- **功能键**：Delete、Backspace、Enter、Tab、Escape、Space
- **特殊键**：CapsLock

#### 修饰键组合
- **Ctrl + 键**：支持所有Ctrl组合键
- **Alt + 键**：支持所有Alt组合键  
- **Shift + 键**：支持所有Shift组合键
- **Cmd/Win + 键**：支持系统键组合（macOS为Cmd，Windows为Win键）

#### 常用快捷键示例
- `Ctrl + C` / `Cmd + C`：复制
- `Ctrl + V` / `Cmd + V`：粘贴
- `Ctrl + Z` / `Cmd + Z`：撤销
- `Alt + Tab`：切换窗口
- `Ctrl + Alt + Del`：系统快捷键（Windows）

## 🔧 使用方法

### 1. 启用远程控制
1. 连接到远程屏幕后，点击控制栏的 **🎮 启用控制** 按钮
2. 按钮变为 **✅ 控制已启用** 表示成功启用
3. 视频容器会显示绿色边框，鼠标样式变为十字

### 2. 键盘输入焦点
- 点击视频区域使其获得焦点（视频会有蓝色边框）
- 然后就可以进行键盘输入

### 3. 拖拽操作
1. 在需要拖拽的位置按下鼠标
2. 保持按住状态并移动鼠标
3. 视频边框会变成蓝色，表示正在拖拽
4. 松开鼠标完成拖拽

### 4. 调试模式
- 点击 **🐛 调试** 按钮开启调试模式
- 可以看到：
  - 本机平台信息
  - 视频分辨率
  - 鼠标坐标（浏览器坐标 → 视频坐标）
  - 控制状态
  - 拖拽状态（按钮、持续时间）
  - 远程屏幕信息（缩放因子、分辨率）

## 🎯 操作技巧

### 提高精度
- 使用调试模式检查坐标转换是否正确
- 在高分辨率屏幕上可能需要更精确的移动

### 跨平台注意事项
- **Windows → macOS**：系统会自动处理Retina屏幕的缩放
- **macOS → Windows**：按键映射会自动转换（Cmd ↔ Ctrl）
- **键盘快捷键**：某些系统级快捷键可能无法传输

### 性能优化
- 拖拽时移动速度不要过快，避免丢帧
- 长时间操作建议定期重新连接

## 🚨 故障排除

### 坐标偏移问题
1. 开启调试模式检查坐标转换
2. 确认远程屏幕的缩放设置
3. 检查视频分辨率是否与实际屏幕匹配

### 键盘无响应
1. 确保视频区域已获得焦点
2. 某些系统快捷键可能被拦截
3. 检查远程端是否有输入法冲突

### 拖拽不流畅
1. 检查网络延迟
2. 降低移动速度
3. 确认鼠标事件正确传输

## 📋 技术细节

### 支持的事件类型
- `mousemove` / `mousedrag`：鼠标移动/拖拽
- `mousedown` / `mouseup`：鼠标按下/释放
- `doubleclick`：双击
- `contextmenu`：右键菜单
- `longpress`：长按
- `scroll`：滚轮滚动
- `keydown` / `keyup`：键盘按下/释放

### 坐标转换
- 自动处理不同平台的DPI缩放
- 支持多屏幕环境的坐标偏移
- 视频分辨率与屏幕分辨率的映射

### 平台兼容性
- ✅ Windows 10/11
- ✅ macOS 10.14+
- ✅ Linux（部分功能）
- ✅ 跨平台控制