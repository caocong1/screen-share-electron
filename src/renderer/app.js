import { config } from '../lib/config.js';
import { P2PConnection } from '../lib/p2p-connection.js';

/**
 * SignalClient 类负责与信令服务器的 WebSocket 通信
 */
class SignalClient extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('信令服务器已连接');
      this.reconnectAttempts = 0;
      this.dispatchEvent(new Event('open'));
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.dispatchEvent(new CustomEvent('message', { detail: message }));
      } catch (error) {
        console.error('解析信令消息失败:', error);
      }
    };

    this.ws.onclose = () => {
      console.warn('与信令服务器的连接已断开');
      this.dispatchEvent(new Event('close'));
      this._reconnect();
    };

    this.ws.onerror = (error) => {
      console.error('信令服务器连接错误:', error);
    };
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('信令连接未打开，无法发送消息:', message);
    }
  }

  _reconnect() {
    if (this.reconnectAttempts < config.signaling.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`尝试重新连接 (${this.reconnectAttempts})...`);
      setTimeout(() => this.connect(), config.signaling.reconnectInterval);
    } else {
      console.error('已达到最大重连次数，停止重连');
    }
  }
}

/**
 * 主应用类
 */
class ScreenShareApp {
  constructor() {
    this.userId = null;
    this.localStream = null;
    this.p2pConnections = new Map();
    this.allUsers = new Map();
    this.isControlEnabled = false;
    
    // 添加全局键盘监听器的引用
    this.globalKeyDownHandler = null;
    this.globalKeyUpHandler = null;

    // 全局鼠标监听状态
    this.globalMouseMode = false;
    this.virtualCursor = null;
    this.lastGlobalMousePosition = { x: 0, y: 0 };
    this.globalMouseButtonState = { left: false, right: false, middle: false };
    
    // 绑定全局鼠标事件处理函数
    this.handleGlobalMouseMove = this.handleGlobalMouseMove.bind(this);
    this.handleCursorVisibilityChanged = this.handleCursorVisibilityChanged.bind(this);

    this.initDomElements();
    this.bindUIEvents();
    this.initAppAndConnect();
  }

  initDomElements() {
    this.dom = {
      // Pages
      modeSelection: document.getElementById('modeSelection'),
      hostPanel: document.getElementById('hostPanel'),
      guestPanel: document.getElementById('guestPanel'),
      screenView: document.getElementById('screenView'),
      // Buttons
      hostBtn: document.getElementById('hostBtn'),
      guestBtn: document.getElementById('guestBtn'),
      backFromHost: document.getElementById('backFromHost'),
      backFromGuest: document.getElementById('backFromGuest'),
      startScreenShare: document.getElementById('startScreenShare'),
      refreshUsers: document.getElementById('refreshUsers'),
      toggleControl: document.getElementById('toggleControl'),
      toggleFullscreen: document.getElementById('toggleFullscreen'),
      toggleKeyboard: document.getElementById('toggleKeyboard'),
      stopViewing: document.getElementById('stopViewing'),
      // Display Areas
      screenSources: document.getElementById('screenSources'),
      participantsList: document.getElementById('participantsList'),
      participantCount: document.getElementById('participantCount'),
      onlineUsersList: document.getElementById('onlineUsersList'),
      remoteVideo: document.getElementById('remoteVideo'),
      videoOverlay: document.getElementById('videoOverlay'),
      // Status
      connectionStatus: document.getElementById('connectionStatus'),
      networkInfo: document.getElementById('networkInfo'),
      appStatus: document.getElementById('appStatus'),
      viewTitle: document.getElementById('viewTitle'),
      // Virtual keyboard elements
      virtualKeyboard: document.getElementById('virtualKeyboard'),
      keyboardClose: document.getElementById('keyboardClose'),
      keyboardNotice: document.getElementById('keyboardNotice'),
      textInput: document.getElementById('textInput'),
      sendText: document.getElementById('sendText'),
      sendEnter: document.getElementById('sendEnter'),
      clearText: document.getElementById('clearText'),
      // Fullscreen elements
      videoContainer: document.getElementById('videoContainer'),
      fullscreenControls: document.getElementById('fullscreenControls'),
      fullscreenToggleControl: document.getElementById('fullscreenToggleControl'),
      fullscreenToggleKeyboard: document.getElementById('fullscreenToggleKeyboard'),
      fullscreenExitFullscreen: document.getElementById('fullscreenExitFullscreen'),
      fullscreenStopViewing: document.getElementById('fullscreenStopViewing'),
      // Pointer lock elements
      pointerLockHint: document.getElementById('pointerLockHint'),
    };
    
    window.app = this; // 方便控制台调试
  }

  initSignalClient() {
    if (!this.userId) {
      return;
    }
    const { secure, host, port, path } = config.signaling;
    const signalUrl = `${secure ? 'wss' : 'ws'}://${host}:${port}${path}`;
    this.signal = new SignalClient(signalUrl);

    this.signal.addEventListener('open', () => {
      this.updateConnectionStatus(true);
      this.signal.send({ type: 'register', id: this.userId });
    });

    this.signal.addEventListener('close', () => this.updateConnectionStatus(false));
    this.signal.addEventListener('message', this.handleSignalMessage.bind(this));
    this.signal.connect();
  }

  bindUIEvents() {
    const BINDINGS = {
      hostBtn: () => this.showPanel('hostPanel'),
      guestBtn: () => this.showPanel('guestPanel'),
      backFromHost: () => this.showPanel('modeSelection'),
      backFromGuest: () => this.showPanel('modeSelection'),
      startScreenShare: this.startSharing.bind(this),

      toggleControl: this.toggleRemoteControl.bind(this),
      toggleFullscreen: () => {
        this.toggleFullscreen();
      },
      toggleKeyboard: this.toggleVirtualKeyboard.bind(this),
      stopViewing: this.stopViewing.bind(this),
    };

    for (const [id, handler] of Object.entries(BINDINGS)) {
      if (this.dom[id]) {
        this.dom[id].onclick = handler;
      } else {
        console.error(`[UI BINDING] 关键元素未找到: #${id}`);
      }
    }
    
    if (this.dom.remoteVideo) {
        // 禁用视频控件和默认行为
        this.dom.remoteVideo.controls = false;
        this.dom.remoteVideo.disablePictureInPicture = true;
        this.dom.remoteVideo.setAttribute('playsinline', 'true');
        
        // 鼠标事件已改为直接获取鼠标信息的方式，不再使用DOM事件
        
        // 视频元素基本设置
        this.dom.remoteVideo.tabIndex = 0; // 使视频元素可以获得焦点
        
        // 禁用选择和拖拽
        this.dom.remoteVideo.style.userSelect = 'none';
        this.dom.remoteVideo.style.webkitUserSelect = 'none';
        this.dom.remoteVideo.style.pointerEvents = 'auto';
    } else {
        console.error(`[UI BINDING] 关键元素未找到: #remoteVideo`);
    }
    
    // 绑定虚拟键盘事件
    this.bindVirtualKeyboardEvents();
    
    // 绑定全屏事件
    this.bindFullscreenEvents();
    
         // 绑定视频容器点击事件（用于启用指针锁定）
     if (this.dom.videoContainer) {
       this.dom.videoContainer.addEventListener('click', () => {
         if (this.isControlEnabled && !this.globalMouseMode && !document.pointerLockElement) {
           this.enablePointerLock();
         }
       });
       
       // 鼠标进入时显示提示
       this.dom.videoContainer.addEventListener('mouseenter', () => {
         if (this.isControlEnabled && !this.globalMouseMode && !document.pointerLockElement && this.dom.pointerLockHint) {
           this.dom.pointerLockHint.classList.add('show');
         }
       });
       
       // 鼠标离开时隐藏提示
       this.dom.videoContainer.addEventListener('mouseleave', () => {
         if (this.dom.pointerLockHint) {
           this.dom.pointerLockHint.classList.remove('show');
         }
       });
     }
  }

  async initAppAndConnect() {
    await this.initAppStatus();
    this.initSignalClient();
    this.showPanel('modeSelection');
  }

  async initAppStatus() {
    const { getNetworkInfo } = window.electronAPI;
    const netInfo = await getNetworkInfo();
    const ip = netInfo.addresses[0]?.address || `user-${Math.random().toString(36).substring(2, 9)}`;
    this.userId = ip;
    this.dom.networkInfo.textContent = this.userId;
  }

  showPanel(panelName) {
    try {
      console.log(`[UI] Switching to panel: ${panelName}`);
      const panels = ['modeSelection', 'hostPanel', 'guestPanel', 'screenView'];

      panels.forEach(p => {
        const panelElement = this.dom[p];
        if (panelElement) {
          if (p === panelName) {
            // 根据面板类型设置正确的显示样式
            if (p === 'modeSelection') {
              panelElement.style.display = 'grid'; // 保持grid布局
            } else {
              panelElement.style.display = 'block';
            }
          } else {
            panelElement.style.display = 'none';
          }
        } else {
          console.error(`[UI] Panel element '${p}' not found in this.dom`);
        }
      });

      if (panelName === 'hostPanel') {
        this.loadScreenSources();
      } else if (panelName === 'modeSelection') {
        this.stopSharing();
        this.stopViewing();
        // 切换到主菜单时清理全局键盘监听
        this.disableGlobalKeyboardControl();
      } else if (panelName !== 'screenView') {
        // 如果不是屏幕视图，清理全局键盘监听
        this.disableGlobalKeyboardControl();
      }
    } catch (error) {
      console.error(`[UI] Error in showPanel while switching to '${panelName}':`, error);
      // Optional: Display a user-facing error message
    }
  }

  updateConnectionStatus(isConnected) {
    if (isConnected) {
      this.dom.connectionStatus.textContent = '在线';
      this.dom.connectionStatus.className = 'status-indicator online';
    } else {
      this.dom.connectionStatus.textContent = '离线';
      this.dom.connectionStatus.className = 'status-indicator offline';
    }
  }

  handleSignalMessage({ detail: message }) {
    console.log('收到信令:', message);
    switch (message.type) {
      case 'registered':
        this.userId = message.id; // 服务器可能会分配一个ID
        break;
      case 'users-list': // 修改：处理全量用户列表
        this.updateOnlineUsersList(message.users);
        break;
      case 'user-online': // 修改：处理单个用户上线
        this.addOnlineUser(message.userId);
        break;
      case 'user-offline': // 修改：处理单个用户下线
        this.removeOnlineUser(message.userId);
        break;
      case 'hosts-list':
        this.updateHostStatus(message.hosts);
        break;
      case 'host-online':
        this.updateHostStatus([message.host]);
        break;
      case 'host-offline':
        this.updateHostStatus([{ id: message.hostId, isHosting: false }]);
        break;
      case 'offer':
        this.handleOffer(message.from, message.data);
        break;
      case 'answer':
        this.handleAnswer(message.from, message.data);
        break;
      case 'ice-candidate':
        this.handleIceCandidate(message.from, message.data);
        break;
    }
  }

  // --- 主机逻辑 ---
  async loadScreenSources() {
    try {
      this.dom.screenSources.innerHTML = '<p>正在检查屏幕录制权限...</p>';

      if (window.electronAPI.platform === 'darwin') {
        const hasPermission = await window.electronAPI.manageScreenPermission();
        if (!hasPermission) {
          this.dom.screenSources.innerHTML = `<p style="color: red;">屏幕录制权限被拒绝。请在系统设置中授权后，返回主菜单再试。</p>`;
          this.dom.startScreenShare.disabled = true;
          return;
        }
      }

      this.dom.screenSources.innerHTML = '<p>正在获取屏幕源...</p>';
      const sources = await window.electronAPI.getDesktopSources();
      console.log('[LOAD-SOURCES] 源:', sources);
      
      console.log('[LOAD-SOURCES] 获取到的屏幕源:', sources.length, '个');
      sources.forEach((source, index) => {
        console.log(`[LOAD-SOURCES] 源 ${index}:`, {
          id: source.id,
          name: source.name,
          hasScreenInfo: !!source.screenInfo,
          screenInfo: source.screenInfo
        });
      });

      this.dom.screenSources.innerHTML = ''; // 清空"加载中"提示

      if (!sources || sources.length === 0) {
        this.dom.screenSources.innerHTML = '<p>未能获取到屏幕或窗口源。</p>';
        return;
      }

      sources.forEach((source, index) => {
        if (!source || !source.id || !source.name || !source.thumbnail) {
            console.warn(`[LOAD-SOURCES] 发现无效的屏幕源 ${index}:`, source);
            return; // 跳过这个无效的源
        }

        const el = document.createElement('div');
        el.className = 'screen-source';
        el.onclick = () => {
          if (this.selectedSourceEl) {
            this.selectedSourceEl.classList.remove('selected');
          }
          el.classList.add('selected');
          this.selectedSourceEl = el;
          this.selectedSourceId = source.id;
          this.selectedScreenInfo = source.screenInfo; // 保存屏幕信息
          this.selectedSourceName = source.name; // 保存源名称
          
          // 判断源类型并记录
          const isWindow = source.id.includes('window:') || (source.screenInfo?.bounds.x > 0 || source.screenInfo?.bounds.y > 0);
          
          console.log('[SOURCE-SELECT] 选择了源:', {
            id: source.id,
            name: source.name,
            type: isWindow ? '窗口' : '屏幕',
            screenInfo: source.screenInfo,
            windowInfo: source.windowInfo,
            isWindow: isWindow
          });
          
          // 如果是窗口源，尝试获取更详细的窗口信息
          if (isWindow && window.electronAPI.getWindowDetails) {
            window.electronAPI.getWindowDetails(source.id).then(windowDetails => {
              if (windowDetails && windowDetails.windowBounds) {
                console.log('[WINDOW-DETAILS] 获取到窗口详细信息:', windowDetails);
                
                // 更新屏幕信息以包含实际的窗口位置
                this.selectedScreenInfo = {
                  ...source.screenInfo,
                  windowBounds: windowDetails.windowBounds,
                  relativePosition: windowDetails.relativePosition,
                  actualDisplay: windowDetails.displayInfo,
                  isActualWindow: true
                };
                
                console.log('[WINDOW-DETAILS] 更新了屏幕信息:', this.selectedScreenInfo);
              }
            }).catch(error => {
              console.warn('[WINDOW-DETAILS] 无法获取窗口详细信息:', error);
            });
          }
          
          this.dom.startScreenShare.disabled = false;
        };
        
        // 构建显示名称，包含屏幕信息和类型标识
        let displayName = source.name;
        if (source.screenInfo) {
          const { bounds, isPrimary } = source.screenInfo;
          const isWindow = source.id.includes('window:');
          
          if (isWindow) {
            // 窗口源
            let windowTypeText = '🪟 窗口';
            let positionText = '';
            let sizeText = `${bounds.width}×${bounds.height}`;
            
            // 检查是否有实际窗口位置信息
            if (source.screenInfo.actualWindowBounds) {
              const actualBounds = source.screenInfo.actualWindowBounds;
              windowTypeText = '🎯 窗口 (实际位置)';
              positionText = ` @(${actualBounds.x},${actualBounds.y})`;
              sizeText = `${actualBounds.width}×${actualBounds.height}`;
              
              // 显示所在显示器信息
              const displayText = source.screenInfo.displayId ? ` [显示器${source.screenInfo.displayId}]` : '';
              displayName = `${windowTypeText}: ${source.name}${displayText} - ${sizeText}${positionText}`;
            } else if (source.screenInfo.estimated) {
              windowTypeText = '📍 窗口 (估算位置)';
              positionText = ` @(${bounds.x},${bounds.y})`;
              displayName = `${windowTypeText}: ${source.name} - ${sizeText}${positionText}`;
            } else {
              positionText = bounds.x !== 0 || bounds.y !== 0 ? ` @(${bounds.x},${bounds.y})` : '';
              displayName = `${windowTypeText}: ${source.name} - ${sizeText}${positionText}`;
            }
          } else {
            // 屏幕源
            const typeText = '🖥️ 屏幕';
            const primaryText = isPrimary ? ' (主屏幕)' : '';
            const positionText = bounds.x !== 0 || bounds.y !== 0 ? ` @(${bounds.x},${bounds.y})` : '';
            displayName = `${typeText}: ${source.name}${primaryText} - ${bounds.width}×${bounds.height}${positionText}`;
          }
        }

        el.innerHTML = `
          <img src="${source.thumbnail}" alt="${source.name}">
          <div class="source-name">${displayName}</div>
        `;
        this.dom.screenSources.appendChild(el);
      });
    } catch (error) {
      console.error('加载屏幕源时发生严重错误:', error);
      if (this.dom.screenSources) {
        this.dom.screenSources.innerHTML = `<p style="color: red;">加载屏幕源失败。请打开开发者工具 (View > Toggle Developer Tools) 查看 Console 中的详细错误信息。</p>`;
      }
    }
  }

  async startSharing() {
    if (!this.selectedSourceId) {
      alert('请先选择一个要分享的屏幕或窗口。');
      return;
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: this.selectedSourceId,
            ...config.webrtc.screenVideoConstraints
          }
        }
      });
      const iconSpan = this.dom.startScreenShare.querySelector('.btn-icon');
      const textSpan = this.dom.startScreenShare.querySelector('.btn-text');
      iconSpan.textContent = '⏹️';
      textSpan.textContent = '停止分享';
      this.dom.startScreenShare.onclick = this.stopSharing.bind(this);
      
      console.log('[SCREEN-SHARE] 发送主机宣告，屏幕信息:', this.selectedScreenInfo);
      this.signal.send({ 
        type: 'announce-host',
        screenInfo: this.selectedScreenInfo
      });
      this.updateAppStatus(`正在分享屏幕...`);
    } catch (error) {
      console.error('获取媒体流失败:', error);
      alert('无法开始屏幕分享。请检查权限设置。');
    }
  }

  stopSharing() {
    if (!this.localStream) return;

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }
    this.signal.send({ type: 'stop-hosting' });
    Object.values(this.p2pConnections).forEach(conn => conn.close());
    this.p2pConnections.clear();
    const iconSpan = this.dom.startScreenShare.querySelector('.btn-icon');
    const textSpan = this.dom.startScreenShare.querySelector('.btn-text');
    iconSpan.textContent = '▶️';
    textSpan.textContent = '开始屏幕分享';
    this.dom.startScreenShare.onclick = this.startSharing.bind(this);
    this.updateAppStatus('就绪');
    this.updateParticipantsList();
    
    // 清空选中的屏幕信息
    this.selectedSourceId = null;
    this.selectedScreenInfo = null;
    this.selectedSourceEl = null;
  }
  
  updateParticipantsList() {
    const count = this.p2pConnections.size;
    this.dom.participantCount.textContent = count;
    this.dom.participantsList.innerHTML = '';
    if (count === 0) {
      this.dom.participantsList.innerHTML = '<li>暂无观看者</li>';
      return;
    }
    for (const remoteId of this.p2pConnections.keys()) {
      const item = document.createElement('li');
      item.className = 'participant-item';
      item.innerHTML = `<div class="participant-avatar">${remoteId.charAt(0).toUpperCase()}</div> ${remoteId}`;
      this.dom.participantsList.appendChild(item);
    }
  }

  // --- 访客逻辑 (重构为在线用户列表) ---
  updateOnlineUsersList(users) {
    this.allUsers = new Map();
    users.forEach(id => this.allUsers.set(id, { id, isHosting: false }));
    this.renderUserList();
    // 主机状态会通过 hosts-list 消息自动推送，不需要手动获取
  }

  addOnlineUser(userId) {
    if (!this.allUsers) this.allUsers = new Map();
    this.allUsers.set(userId, { id: userId, isHosting: false });
    this.renderUserList();
  }

  removeOnlineUser(userId) {
    if (this.allUsers) {
        this.allUsers.delete(userId);
        this.renderUserList();
    }
  }

  updateHostStatus(hosts) {
      if (!this.allUsers) return;
      console.log('[HOST-STATUS] 更新主机状态:', hosts);
      hosts.forEach(host => {
          const user = this.allUsers.get(host.id);
          if (user) {
              user.isHosting = host.isHosting !== false;
              user.name = host.name;
              // 更新屏幕信息
              if (host.screenInfo) {
                  user.screenInfo = host.screenInfo;
                  console.log(`[HOST-STATUS] 主机 ${host.id} 屏幕信息:`, host.screenInfo);
              }
          }
      });
      this.renderUserList();
  }

  renderUserList() {
    const listEl = this.dom.onlineUsersList;
    listEl.innerHTML = '';
    if (!this.allUsers || this.allUsers.size === 0) {
      listEl.innerHTML = '<p class="no-users">暂无其他在线用户</p>';
      return;
    }

    this.allUsers.forEach(user => {
      if (user.id === this.userId) return; // 不显示自己

      const el = document.createElement('div');
      el.className = 'user-item';
      
      const statusClass = user.isHosting ? 'hosting' : 'idle';
      const statusText = user.isHosting ? '正在分享' : '在线';

      el.innerHTML = `
        <div class="user-info">
          <div class="user-avatar">${(user.name || user.id).charAt(0).toUpperCase()}</div>
          <div class="user-name">${user.name || user.id}</div>
        </div>
        <div class="user-actions">
          <div class="user-status ${statusClass}">${statusText}</div>
          <button class="connect-btn${!user.isHosting ? ' disabled' : ''}" ${!user.isHosting ? 'disabled' : ''}>
            <span class="btn-icon">👀</span>
            <span class="btn-text">观看</span>
          </button>
        </div>
      `;
      const connectBtn = el.querySelector('.connect-btn');
      if (user.isHosting) {
        connectBtn.onclick = () => this.connectToHost(user.id);
      } else {
        connectBtn.onclick = () => {
          console.log(`用户 ${user.id} 未在分享屏幕，无法连接`);
        };
      }
      listEl.appendChild(el);
    });
  }

  async connectToHost(hostId) {
    if (this.p2pConnections.has(hostId)) return;
    this.updateAppStatus(`正在连接到 ${hostId}...`);

    // 确保在连接前显示遮罩层
    this.dom.videoOverlay.style.display = 'flex';

    const p2p = new P2PConnection(this.userId, hostId, { isGuest: true });
    this.p2pConnections.set(hostId, p2p);

    // 添加数据通道事件调试
    p2p.addEventListener('controlopen', () => {
      console.log('[VIEWER] 数据通道已打开，等待主机发送屏幕信息...');
    });

    p2p.addEventListener('icecandidate', ({ detail: candidate }) => {
      this.signal.send({ type: 'ice-candidate', to: hostId, from: this.userId, data: candidate });
    });
    p2p.addEventListener('stream', ({ detail: stream }) => {
      this.dom.remoteVideo.srcObject = stream;
      this.showPanel('screenView');
      const host = this.allUsers.get(hostId);
      this.dom.viewTitle.textContent = `正在观看 ${host?.name || hostId} 的屏幕`;

      this.dom.remoteVideo.onplaying = () => {
        this.dom.videoOverlay.style.display = 'none';
      };
      
      // 初始化时禁用控制按钮，等待屏幕信息就绪
      if (this.dom.toggleControl) {
        this.dom.toggleControl.disabled = true;
        this.dom.toggleControl.title = '等待屏幕信息...';
      }
      this.updateAppStatus('视频流已连接，等待屏幕信息...');
    });
    p2p.addEventListener('close', () => this.showPanel('guestPanel'));
    
    // 为观看端也添加控制事件监听器（虽然通常不会接收控制指令，但确保控制通道正常工作）
    p2p.addEventListener('control', ({ detail: command }) => {
      console.log('[观看端] 接收到控制反馈:', command);
      // 修复：处理来自主机的屏幕信息
      if (command.type === 'screen-info' && command.screenInfo) {
        p2p.remoteScreenInfo = command.screenInfo;
        console.log('[VIEWER] 通过数据通道接收到屏幕信息:', command.screenInfo);
        
        // 屏幕信息就绪后，启用控制按钮并给出提示
        if (this.dom.toggleControl) {
          this.dom.toggleControl.disabled = false;
          this.dom.toggleControl.title = '点击启用远程控制';
        }
        this.updateAppStatus('屏幕信息已就绪，可以启用远程控制');
      }
      // 观看端通常不需要处理其他控制指令，但这里可以处理一些状态反馈
    });

    // 尝试从主机信息中获取屏幕信息
    const host = this.allUsers.get(hostId);
    console.log('[VIEWER] 连接前检查主机信息:', {
      hostId,
      hasHost: !!host,
      hasScreenInfo: !!(host?.screenInfo),
      hostInfo: host
    });
    
    if (host && host.screenInfo) {
      p2p.remoteScreenInfo = host.screenInfo;
      console.log(`[VIEWER] 连接到主机 ${hostId}，从用户列表获取屏幕信息:`, host.screenInfo);
      
      // 如果从用户列表已经获取到屏幕信息，立即启用控制按钮
      setTimeout(() => {
        if (this.dom.toggleControl) {
          this.dom.toggleControl.disabled = false;
          this.dom.toggleControl.title = '点击启用远程控制';
        }
        this.updateAppStatus('屏幕信息已就绪，可以启用远程控制');
      }, 1000); // 延迟1秒确保UI已更新
    } else {
      console.log(`[VIEWER] 连接到主机 ${hostId}，但没有屏幕信息，等待数据通道传递`);
    }

    const offer = await p2p.createOffer(new MediaStream());
    this.signal.send({ type: 'offer', to: hostId, from: this.userId, data: offer });
  }
  
  stopViewing() {
    if (this.p2pConnections.size === 0) return; // 如果没有在观看，则直接返回

    this.p2pConnections.forEach(conn => conn.close());
    this.p2pConnections.clear();
    this.dom.remoteVideo.srcObject = null;
    this.dom.remoteVideo.onplaying = null; // 清理事件监听器
    this.showPanel('guestPanel');

    // 重置遮罩层状态，为下次连接做准备
    this.dom.videoOverlay.style.display = 'flex';
    
    // 重置控制状态并清理全局键盘监听
    this.isControlEnabled = false;
    this.disableGlobalKeyboardControl();
  }

  // --- WebRTC 信令处理 ---
  async handleOffer(fromId, offer) {
    if (!this.localStream) return;

    let p2p = this.p2pConnections.get(fromId);
    if (p2p) p2p.close();
    
    p2p = new P2PConnection(this.userId, fromId);
    this.p2pConnections.set(fromId, p2p);
    this.updateParticipantsList();

    p2p.addEventListener('icecandidate', ({ detail: candidate }) => {
      this.signal.send({ type: 'ice-candidate', to: fromId, from: this.userId, data: candidate });
    });
    p2p.addEventListener('close', () => {
      this.p2pConnections.delete(fromId);
      this.updateParticipantsList();
    });
    
    // 关键修复：为共享端的连接添加控制指令处理器
    p2p.addEventListener('control', ({ detail: command }) => {
      // 安全检查：确保只有在分享状态下才执行控制
      if (this.localStream) {
        // 添加当前分享屏幕的信息到控制指令
        const enrichedCommand = {
          ...command,
          screenInfo: this.selectedScreenInfo
        };
        window.electronAPI.sendRemoteControl(enrichedCommand);
      }
    });
    
    // 修复：添加数据通道打开事件监听，主动发送屏幕信息
    p2p.addEventListener('controlopen', () => {
      // 数据通道打开后，主动发送屏幕信息给观看端
      console.log('[HOST] 数据通道已打开，准备发送屏幕信息...');
      
      // 稍微延迟发送，确保连接稳定
      setTimeout(() => {
        if (this.selectedScreenInfo) {
          console.log('[HOST] 发送屏幕信息给观看端:', this.selectedScreenInfo);
          p2p.sendControlCommand({
            type: 'screen-info',
            screenInfo: this.selectedScreenInfo
          });
        } else {
          console.warn('[HOST] 警告：selectedScreenInfo 为空，无法发送屏幕信息');
        }
      }, 500); // 延迟500ms确保连接稳定
    });
    
    // 为P2P连接设置屏幕信息
    p2p.remoteScreenInfo = this.selectedScreenInfo;

    const answer = await p2p.createAnswer(offer, this.localStream);
    this.signal.send({ type: 'answer', to: fromId, from: this.userId, data: answer });
  }

  async handleAnswer(fromId, answer) {
    const p2p = this.p2pConnections.get(fromId);
    if (p2p) {
      await p2p.acceptAnswer(answer);
    }
  }

  async handleIceCandidate(fromId, candidate) {
    const p2p = this.p2pConnections.get(fromId);
    if (p2p) {
      await p2p.addIceCandidate(candidate);
    }
  }
  
  // --- 远程控制 ---
  async toggleRemoteControl() {
    if (!this.isControlEnabled) {
      // 启动远程控制时，询问是否使用全局鼠标模式
      const useGlobalMouse = confirm('是否使用全局鼠标模式？\n\n全局鼠标模式可以避免坐标转换问题，提供更精确的控制。\n\n点击"确定"使用全局鼠标模式\n点击"取消"使用传统DOM事件模式');
      
      if (useGlobalMouse) {
        await this.toggleGlobalMouseMode();
      } else {
        // 使用DOM模式时启用指针锁定
        await this.enablePointerLock();
      }
    }
    
    // 原有的远程控制逻辑
    this.isControlEnabled = !this.isControlEnabled;
    
    if (this.isControlEnabled) {
      this.dom.remoteVideo.style.cursor = 'crosshair';
      this.enableGlobalKeyboardControl();
      this.updateAppStatus('远程控制已启用 - 可以控制远程桌面');
    } else {
      // 停止远程控制时，同时停止全局鼠标模式和指针锁定
      if (this.globalMouseMode) {
        await this.stopGlobalMouseMode();
      } else {
        await this.disablePointerLock();
      }
      
      this.dom.remoteVideo.style.cursor = '';
      this.disableGlobalKeyboardControl();
      this.updateAppStatus('远程控制已禁用');
    }
    
    // 更新按钮状态
    const controlButton = document.getElementById('toggleControl');
    if (controlButton) {
      const textSpan = controlButton.querySelector('.btn-text');
      const iconSpan = controlButton.querySelector('.btn-icon');
      
      if (textSpan) {
        textSpan.textContent = this.isControlEnabled ? '禁用控制' : '启用控制';
      }
      if (iconSpan) {
        iconSpan.textContent = this.isControlEnabled ? '⏹️' : '🎮';
      }
      
      if (this.isControlEnabled) {
        controlButton.classList.add('danger');
      } else {
        controlButton.classList.remove('danger');
      }
    }
    
    console.log(`远程控制已${this.isControlEnabled ? '启用' : '禁用'}`);
  }

  // 启用全局键盘控制
  enableGlobalKeyboardControl() {
    // 如果已经有监听器，先移除
    this.disableGlobalKeyboardControl();
    
    // 创建全局键盘事件处理器
    this.globalKeyDownHandler = (e) => {
      // 防止在输入框中触发全局键盘控制
      if (this.isInputElement(e.target)) {
        return;
      }
      
      this.handleGlobalKeyDown(e);
    };
    
    this.globalKeyUpHandler = (e) => {
      // 防止在输入框中触发全局键盘控制
      if (this.isInputElement(e.target)) {
        return;
      }
      
      this.handleGlobalKeyUp(e);
    };
    
    // 在文档级别添加键盘事件监听器
    document.addEventListener('keydown', this.globalKeyDownHandler, true);
    document.addEventListener('keyup', this.globalKeyUpHandler, true);
    
    // 更新调试信息
    if (this.dom.globalKeyboardStatus) {
      this.dom.globalKeyboardStatus.textContent = '启用';
    }
    
    console.log('[全局键盘] 已启用全局键盘监听');
  }

  // 禁用全局键盘控制
  disableGlobalKeyboardControl() {
    if (this.globalKeyDownHandler) {
      document.removeEventListener('keydown', this.globalKeyDownHandler, true);
      this.globalKeyDownHandler = null;
    }
    
    if (this.globalKeyUpHandler) {
      document.removeEventListener('keyup', this.globalKeyUpHandler, true);
      this.globalKeyUpHandler = null;
    }
    
    // 更新调试信息
    if (this.dom.globalKeyboardStatus) {
      this.dom.globalKeyboardStatus.textContent = '禁用';
    }
    
    console.log('[全局键盘] 已禁用全局键盘监听');
  }

  // 检查是否为输入元素
  isInputElement(element) {
    if (!element) return false;
    
    const inputTypes = ['INPUT', 'TEXTAREA', 'SELECT'];
    if (inputTypes.includes(element.tagName)) return true;
    
    // 检查是否为可编辑元素
    if (element.contentEditable === 'true') return true;
    
    // 检查虚拟键盘的文本输入框
    if (element.id === 'textInput') return true;
    
    return false;
  }

  // 全局键盘按下处理器
  handleGlobalKeyDown(e) {
    if (!this.isControlEnabled) return;
    
    // 特殊处理 ESC 键 - 退出控制模式
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      console.log('[快捷键] ESC键退出控制模式');
      this.updateAppStatus('ESC键退出控制模式');
      this.toggleRemoteControl();
      return;
    }
    
    // 某些特殊键需要阻止默认行为
    const specialKeys = ['Tab', 'F5', 'F11', 'F12', 'Alt', 'Control', 'Meta'];
    if (specialKeys.includes(e.key) || e.ctrlKey || e.altKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
    }

    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;

    console.log('[全局键盘按下]', { 
      key: e.key, 
      code: e.code, 
      ctrlKey: e.ctrlKey, 
      altKey: e.altKey, 
      shiftKey: e.shiftKey, 
      metaKey: e.metaKey,
      target: e.target.tagName
    });

    const command = {
      type: 'keydown',
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      clientPlatform: window.electronAPI.platform,
      source: 'global' // 标记这是全局键盘事件
    };

    p2p.sendControlCommand(command);
  }

  // 全局键盘释放处理器
  handleGlobalKeyUp(e) {
    if (!this.isControlEnabled) return;
    
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;

    console.log('[全局键盘释放]', { 
      key: e.key, 
      code: e.code,
      target: e.target.tagName
    });

    const command = {
      type: 'keyup',
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      clientPlatform: window.electronAPI.platform,
      source: 'global' // 标记这是全局键盘事件
    };

    p2p.sendControlCommand(command);
  }

  // --- 虚拟键盘功能 ---
  toggleVirtualKeyboard() {
    this.isKeyboardVisible = !this.isKeyboardVisible;
    
    const iconSpan = this.dom.toggleKeyboard.querySelector('.btn-icon');
    const textSpan = this.dom.toggleKeyboard.querySelector('.btn-text');
    
    if (this.isKeyboardVisible) {
      iconSpan.textContent = '✅';
      textSpan.textContent = '键盘已显示';
      this.dom.toggleKeyboard.classList.add('control-enabled');
      this.dom.virtualKeyboard.style.display = 'block';
      
      // 显示全局键盘提示（仅在控制模式启用时）
      if (this.dom.keyboardNotice && this.isControlEnabled) {
        this.dom.keyboardNotice.style.display = 'block';
      }
      
      this.updatePlatformSpecificShortcuts();
    } else {
      iconSpan.textContent = '⌨️';
      textSpan.textContent = '键盘';
      this.dom.toggleKeyboard.classList.remove('control-enabled');
      this.dom.virtualKeyboard.style.display = 'none';
      
      // 隐藏全局键盘提示
      if (this.dom.keyboardNotice) {
        this.dom.keyboardNotice.style.display = 'none';
      }
    }
    
    this.updateAppStatus(this.isKeyboardVisible ? '虚拟键盘已显示' : '虚拟键盘已隐藏');
  }
  
  updatePlatformSpecificShortcuts() {
    // 根据不同平台更新快捷键显示
    const platform = window.electronAPI.platform;
    const isMac = platform === 'darwin';
    
    // 更新Ctrl/Cmd键
    const modKey = isMac ? 'Cmd' : 'Ctrl';
    const winKey = isMac ? 'Cmd' : 'Win';
    
    // 更新常用快捷键
    if (this.dom.virtualKeyboard) {
      const shortcuts = {
        'copy-shortcut': `${modKey}+C`,
        'paste-shortcut': `${modKey}+V`,
        'cut-shortcut': `${modKey}+X`,
        'undo-shortcut': `${modKey}+Z`,
        'redo-shortcut': `${modKey}+Y`,
        'selectall-shortcut': `${modKey}+A`,
        'save-shortcut': `${modKey}+S`,
        'alttab-shortcut': isMac ? 'Cmd+Tab' : 'Alt+Tab',
        'taskmgr-shortcut': isMac ? 'Cmd+Option+Esc' : 'Ctrl+Shift+Esc',
        'lock-shortcut': isMac ? 'Cmd+Control+Q' : 'Win+L',
        'desktop-shortcut': isMac ? 'F11' : 'Win+D',
        'run-shortcut': isMac ? 'Cmd+Space' : 'Win+R'
      };
      
      Object.entries(shortcuts).forEach(([id, text]) => {
        const element = document.getElementById(id);
        if (element) {
          element.textContent = text;
        }
      });
    }
  }

  bindVirtualKeyboardEvents() {
    // 关闭按钮
    if (this.dom.keyboardClose) {
      this.dom.keyboardClose.onclick = () => {
        this.isKeyboardVisible = false;
        this.dom.virtualKeyboard.style.display = 'none';
        const iconSpan = this.dom.toggleKeyboard.querySelector('.btn-icon');
        const textSpan = this.dom.toggleKeyboard.querySelector('.btn-text');
        iconSpan.textContent = '⌨️';
        textSpan.textContent = '键盘';
        this.dom.toggleKeyboard.classList.remove('control-enabled');
      };
    }
    
    // 文本输入功能
    if (this.dom.sendText) {
      this.dom.sendText.onclick = () => this.sendTextInput(false);
    }
    
    if (this.dom.sendEnter) {
      this.dom.sendEnter.onclick = () => this.sendTextInput(true);
    }
    
    if (this.dom.clearText) {
      this.dom.clearText.onclick = () => {
        this.dom.textInput.value = '';
        this.dom.textInput.focus();
      };
    }
    
    // 绑定所有键盘按钮
    if (this.dom.virtualKeyboard) {
      // 快捷键按钮
      this.dom.virtualKeyboard.querySelectorAll('.shortcut-key, .system-key').forEach(btn => {
        btn.onclick = () => {
          const shortcut = btn.dataset.shortcut;
          if (shortcut) {
            this.sendShortcut(shortcut);
          }
        };
      });
      
      // 功能键按钮
      this.dom.virtualKeyboard.querySelectorAll('.function-key').forEach(btn => {
        btn.onclick = () => {
          const key = btn.dataset.key;
          if (key) {
            this.sendFunctionKey(key);
          }
        };
      });
    }
    
    // 初始化键盘显示状态
    this.isKeyboardVisible = false;
  }

  sendTextInput(withEnter = false) {
    const text = this.dom.textInput.value;
    if (!text.trim()) return;
    
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) {
      this.updateAppStatus('未连接到远程主机');
      return;
    }
    
    // 发送文本
    for (const char of text) {
      const command = {
        type: 'keytype',
        text: char,
        clientPlatform: window.electronAPI.platform
      };
      p2p.sendControlCommand(command);
    }
    
    // 如果需要发送回车
    if (withEnter) {
      const enterCommand = {
        type: 'keydown',
        key: 'Enter',
        code: 'Enter',
        clientPlatform: window.electronAPI.platform
      };
      p2p.sendControlCommand(enterCommand);
    }
    
    this.updateAppStatus(`已发送文本: ${text.substring(0, 20)}${text.length > 20 ? '...' : ''}`);
  }

  sendShortcut(shortcut) {
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) {
      this.updateAppStatus('未连接到远程主机');
      return;
    }
    
    // 解析快捷键
    const parts = shortcut.toLowerCase().split('+');
    const modifiers = {
      ctrl: false,
      alt: false,
      shift: false,
      meta: false
    };
    
    let mainKey = '';
    
    parts.forEach(part => {
      switch (part) {
        case 'ctrl':
          modifiers.ctrl = true;
          break;
        case 'alt':
          modifiers.alt = true;
          break;
        case 'shift':
          modifiers.shift = true;
          break;
        case 'cmd':
        case 'win':
          modifiers.meta = true;
          break;
        default:
          mainKey = part;
      }
    });
    
    // 发送快捷键
    const command = {
      type: 'shortcut',
      key: mainKey,
      ctrlKey: modifiers.ctrl,
      altKey: modifiers.alt,
      shiftKey: modifiers.shift,
      metaKey: modifiers.meta,
      clientPlatform: window.electronAPI.platform
    };
    
    p2p.sendControlCommand(command);
    this.updateAppStatus(`已发送快捷键: ${shortcut.toUpperCase()}`);
  }

  sendFunctionKey(key) {
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) {
      this.updateAppStatus('未连接到远程主机');
      return;
    }
    
    const command = {
      type: 'functionkey',
      key: key,
      clientPlatform: window.electronAPI.platform
    };
    
    p2p.sendControlCommand(command);
    this.updateAppStatus(`已发送功能键: ${key}`);
  }

  // --- 全屏控制功能 ---
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      // 进入全屏
      if (this.dom.videoContainer.requestFullscreen) {
        this.dom.videoContainer.requestFullscreen();
      } else if (this.dom.videoContainer.webkitRequestFullscreen) {
        this.dom.videoContainer.webkitRequestFullscreen();
      } else if (this.dom.videoContainer.mozRequestFullScreen) {
        this.dom.videoContainer.mozRequestFullScreen();
      } else if (this.dom.videoContainer.msRequestFullscreen) {
        this.dom.videoContainer.msRequestFullscreen();
      }
    } else {
      // 退出全屏
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }

  bindFullscreenEvents() {
    // 全屏状态变化监听
    const fullscreenChangeHandler = () => {
      const isFullscreen = !!document.fullscreenElement;
      
      if (isFullscreen) {
        // 进入全屏模式
        this.setupFullscreenMouseTracking();
        this.updateFullscreenControlsState();
      } else {
        // 退出全屏模式
        this.cleanupFullscreenMouseTracking();
      }
    };

    // 兼容不同浏览器的全屏事件
    document.addEventListener('fullscreenchange', fullscreenChangeHandler);
    document.addEventListener('webkitfullscreenchange', fullscreenChangeHandler);
    document.addEventListener('mozfullscreenchange', fullscreenChangeHandler);
    document.addEventListener('MSFullscreenChange', fullscreenChangeHandler);

    // 绑定全屏控制按钮事件
    if (this.dom.fullscreenToggleControl) {
      this.dom.fullscreenToggleControl.onclick = () => {
        this.toggleRemoteControl();
        this.updateFullscreenControlsState();
      };
    }

    if (this.dom.fullscreenToggleKeyboard) {
      this.dom.fullscreenToggleKeyboard.onclick = () => {
        this.toggleVirtualKeyboard();
        this.updateFullscreenControlsState();
      };
    }

    if (this.dom.fullscreenExitFullscreen) {
      this.dom.fullscreenExitFullscreen.onclick = () => {
        this.toggleFullscreen();
      };
    }

    if (this.dom.fullscreenStopViewing) {
      this.dom.fullscreenStopViewing.onclick = () => {
        this.stopViewing();
      };
    }
  }

  setupFullscreenMouseTracking() {
    // 鼠标移动超时定时器
    this.fullscreenMouseTimer = null;
    this.fullscreenMouseTimeout = 3000; // 3秒后隐藏控制面板

    const showControls = () => {
      if (this.dom.fullscreenControls) {
        this.dom.fullscreenControls.classList.add('show');
      }
    };

    const hideControls = () => {
      if (this.dom.fullscreenControls) {
        this.dom.fullscreenControls.classList.remove('show');
      }
    };

    const resetMouseTimer = () => {
      showControls();
      
      if (this.fullscreenMouseTimer) {
        clearTimeout(this.fullscreenMouseTimer);
      }
      
      this.fullscreenMouseTimer = setTimeout(() => {
        hideControls();
      }, this.fullscreenMouseTimeout);
    };

    // 鼠标移动事件处理
    this.fullscreenMouseMoveHandler = (e) => {
      // 检查鼠标是否在边缘区域（右上角100px范围内）
      const edgeSize = 100;
      const isInControlArea = e.clientX > window.innerWidth - edgeSize && e.clientY < edgeSize;
      
      if (isInControlArea) {
        showControls();
        if (this.fullscreenMouseTimer) {
          clearTimeout(this.fullscreenMouseTimer);
          this.fullscreenMouseTimer = null;
        }
      } else {
        resetMouseTimer();
      }
    };

    // 鼠标离开事件处理
    this.fullscreenMouseLeaveHandler = () => {
      hideControls();
      if (this.fullscreenMouseTimer) {
        clearTimeout(this.fullscreenMouseTimer);
        this.fullscreenMouseTimer = null;
      }
    };

    // 控制面板悬停事件
    this.fullscreenControlsMouseEnter = () => {
      if (this.fullscreenMouseTimer) {
        clearTimeout(this.fullscreenMouseTimer);
        this.fullscreenMouseTimer = null;
      }
    };

    this.fullscreenControlsMouseLeave = () => {
      resetMouseTimer();
    };

    // 绑定事件
    if (this.dom.videoContainer) {
      this.dom.videoContainer.addEventListener('mousemove', this.fullscreenMouseMoveHandler);
      this.dom.videoContainer.addEventListener('mouseleave', this.fullscreenMouseLeaveHandler);
    }

    if (this.dom.fullscreenControls) {
      this.dom.fullscreenControls.addEventListener('mouseenter', this.fullscreenControlsMouseEnter);
      this.dom.fullscreenControls.addEventListener('mouseleave', this.fullscreenControlsMouseLeave);
    }

    // 初始显示控制面板，然后设置定时器隐藏
    resetMouseTimer();
  }

  cleanupFullscreenMouseTracking() {
    // 清理定时器
    if (this.fullscreenMouseTimer) {
      clearTimeout(this.fullscreenMouseTimer);
      this.fullscreenMouseTimer = null;
    }

    // 移除事件监听器
    if (this.dom.videoContainer && this.fullscreenMouseMoveHandler) {
      this.dom.videoContainer.removeEventListener('mousemove', this.fullscreenMouseMoveHandler);
      this.dom.videoContainer.removeEventListener('mouseleave', this.fullscreenMouseLeaveHandler);
    }

    if (this.dom.fullscreenControls) {
      this.dom.fullscreenControls.removeEventListener('mouseenter', this.fullscreenControlsMouseEnter);
      this.dom.fullscreenControls.removeEventListener('mouseleave', this.fullscreenControlsMouseLeave);
    }

    // 隐藏控制面板
    if (this.dom.fullscreenControls) {
      this.dom.fullscreenControls.classList.remove('show');
    }
  }

  updateFullscreenControlsState() {
    if (!this.dom.fullscreenControls || !document.fullscreenElement) return;

    // 更新控制按钮状态
    if (this.dom.fullscreenToggleControl) {
      const icon = this.dom.fullscreenToggleControl.querySelector('.btn-icon');
      if (icon) {
        icon.textContent = this.isControlEnabled ? '✅' : '🎮';
      }
      if (this.isControlEnabled) {
        this.dom.fullscreenToggleControl.classList.add('control-enabled');
      } else {
        this.dom.fullscreenToggleControl.classList.remove('control-enabled');
      }
    }

    // 更新键盘按钮状态
    if (this.dom.fullscreenToggleKeyboard) {
      const icon = this.dom.fullscreenToggleKeyboard.querySelector('.btn-icon');
      if (icon) {
        icon.textContent = this.isKeyboardVisible ? '✅' : '⌨️';
      }
      if (this.isKeyboardVisible) {
        this.dom.fullscreenToggleKeyboard.classList.add('control-enabled');
      } else {
        this.dom.fullscreenToggleKeyboard.classList.remove('control-enabled');
      }
    }
  }

  // 判断是否为窗口共享（而非全屏幕共享）
  isWindowShare(screenInfo) {
    if (!screenInfo || !screenInfo.bounds) {
      return false;
    }
    
    // 方法1：检查是否有实际窗口边界信息
    if (screenInfo.actualWindowBounds) {
      return true;
    }
    
    // 方法2：检查是否明确标记为实际窗口
    if (screenInfo.isActualWindow) {
      return true;
    }
    
    // 方法3：检查是否有窗口边界信息
    if (screenInfo.windowBounds) {
      return true;
    }
    
    // 方法4：检查源ID是否包含窗口标识
    if (this.selectedSourceId && this.selectedSourceId.includes('window:')) {
      return true;
    }
    
    // 方法5：检查是否有窗口信息标记且具有实际位置
    if (screenInfo.windowInfo && screenInfo.windowInfo.type === 'window') {
      return true;
    }
    
    // 方法6：检查是否有窗口位置偏移且不是显示器边界
    // 对于多显示器环境，需要更智能的判断
    if (screenInfo.bounds.x !== 0 || screenInfo.bounds.y !== 0) {
      // 如果有实际显示器信息，检查窗口是否与显示器边界重合
      if (screenInfo.actualDisplay) {
        const displayBounds = screenInfo.actualDisplay.bounds;
        // 检查窗口的位置和大小是否与显示器完全匹配
        if (screenInfo.bounds.x === displayBounds.x && 
            screenInfo.bounds.y === displayBounds.y &&
            screenInfo.bounds.width === displayBounds.width && 
            screenInfo.bounds.height === displayBounds.height) {
          // 完全匹配显示器边界，可能是全屏应用
          return false;
        }
      }
      return true;
    }
    
    // 方法7：检查尺寸是否明显小于常见屏幕尺寸
    const { width, height } = screenInfo.bounds;
    if (width < 1024 || height < 720) {
      return true;
    }
    
    // 方法8：检查是否为估算值且源ID表明是窗口
    if (screenInfo.estimated && this.selectedSourceId && this.selectedSourceId.includes('window:')) {
      return true;
    }
    
    // 默认认为是全屏幕共享
    return false;
  }

  // 获取远程屏幕信息的辅助方法
  getRemoteScreenInfo() {
    console.log('[SCREEN-INFO] 开始获取远程屏幕信息...');
    
    // 从当前连接的P2P连接中获取远程屏幕信息
    // 这个信息在连接建立时应该被传递
    const p2p = this.p2pConnections.values().next().value;
    console.log('[SCREEN-INFO] P2P连接状态:', {
      hasP2P: !!p2p,
      p2pId: p2p?.remoteId,
      hasRemoteScreenInfo: !!(p2p?.remoteScreenInfo),
      remoteScreenInfo: p2p?.remoteScreenInfo
    });
    
    if (p2p && p2p.remoteScreenInfo) {
      console.log('[SCREEN-INFO] 从P2P连接获取屏幕信息:', p2p.remoteScreenInfo);
      return p2p.remoteScreenInfo;
    }
    
    // 如果没有存储的远程屏幕信息，尝试从已知的屏幕信息中获取
    // 这通常发生在作为主机时，使用本地选中的屏幕信息
    if (this.selectedScreenInfo) {
      console.log('[SCREEN-INFO] 使用本地选中屏幕信息:', this.selectedScreenInfo);
      return this.selectedScreenInfo;
    }
    
    // 调试：尝试从allUsers中获取当前连接的主机屏幕信息
    if (p2p && this.allUsers) {
      const host = this.allUsers.get(p2p.remoteId);
      console.log('[SCREEN-INFO] 检查用户列表:', {
        remoteId: p2p.remoteId,
        hasHost: !!host,
        hostInfo: host,
        allUsersSize: this.allUsers.size
      });
      
      if (host && host.screenInfo) {
        console.log('[SCREEN-INFO] 从用户列表获取屏幕信息:', host.screenInfo);
        p2p.remoteScreenInfo = host.screenInfo; // 缓存到P2P连接中
        return host.screenInfo;
      } else {
        console.log('[SCREEN-INFO] 用户列表中没有屏幕信息');
      }
    }
    
    // 兜底返回null，坐标转换函数会处理这种情况
    console.log('[SCREEN-INFO] 警告：没有可用的屏幕信息');
    return null;
  }

  updateAppStatus(text) {
    this.dom.appStatus.textContent = text;
  }
  
  // 更新光标模式指示器
  updateCursorModeIndicator(mode) {
    const indicator = document.getElementById('cursorModeIndicator');
    const text = document.getElementById('cursorModeText');
    
    if (indicator && text) {
      // 显示指示器
      indicator.classList.add('show');
      
      // 移除之前的模式类
      indicator.classList.remove('global-mode', 'dom-mode');
      
      if (mode === 'global') {
        indicator.classList.add('global-mode');
        text.textContent = '全局鼠标模式';
      } else {
        indicator.classList.add('dom-mode');
        text.textContent = 'DOM事件模式';
      }
      
      // 3秒后自动隐藏
      setTimeout(() => {
        indicator.classList.remove('show');
      }, 3000);
    }
  }

  // 新增：切换全局鼠标模式
  async toggleGlobalMouseMode() {
    try {
      if (!this.globalMouseMode) {
        // 启动全局鼠标模式
        const result = await window.electronAPI.startGlobalMouseListening();
        if (result.success) {
          this.globalMouseMode = true;
          
          // 注册全局鼠标事件监听
          window.electronAPI.onGlobalMouseMove(this.handleGlobalMouseMove);
          window.electronAPI.onCursorVisibilityChanged(this.handleCursorVisibilityChanged);
          
          // 只隐藏视频区域的原生光标，让用户通过远程视频中的光标获得反馈
          this.hideVideoAreaCursor();
          
          console.log('[全局鼠标] 模式已启动');
          this.updateAppStatus('全局鼠标模式已启动 - 通过远程视频中的光标获得反馈');
          
          // 更新按钮状态
          this.updateGlobalMouseButton(true);
          
          // 更新模式指示器
          this.updateCursorModeIndicator('global');
          
        } else {
          console.error('[全局鼠标] 启动失败:', result.message);
          this.updateAppStatus(`全局鼠标模式启动失败: ${result.message}`);
        }
      } else {
        // 停止全局鼠标模式
        await this.stopGlobalMouseMode();
      }
    } catch (error) {
      console.error('[全局鼠标] 切换失败:', error);
      this.updateAppStatus(`全局鼠标模式切换失败: ${error.message}`);
    }
  }

  // 停止全局鼠标模式
  async stopGlobalMouseMode() {
    try {
      if (this.globalMouseMode) {
        // 通过Worker停止全局鼠标监听
        const result = await window.electronAPI.stopGlobalMouseListening();
        if (result.success) {
          // 移除事件监听器
          window.electronAPI.removeGlobalMouseListeners();
          
          // 恢复视频区域的原生光标
          this.showVideoAreaCursor();
          
          this.globalMouseMode = false;
          
          console.log('[全局鼠标] 模式已停止');
          this.updateAppStatus('全局鼠标模式已停止 - 已恢复DOM事件模式');
          
          // 更新按钮状态
          this.updateGlobalMouseButton(false);
          
          // 更新模式指示器
          this.updateCursorModeIndicator('dom');
        } else {
          console.error('[全局鼠标] 停止失败:', result.message);
          this.updateAppStatus(`停止全局鼠标模式失败: ${result.message}`);
        }
      }
    } catch (error) {
      console.error('[全局鼠标] 停止失败:', error);
      this.updateAppStatus(`停止全局鼠标模式失败: ${error.message}`);
    }
  }

  // 创建虚拟光标 - 已禁用，使用远程视频中的光标反馈
  createVirtualCursor() {
    // 不再创建虚拟光标，用户通过远程视频中的光标获得视觉反馈
    console.log('[虚拟光标] 已禁用 - 使用远程视频中的光标反馈');
  }

  // 销毁虚拟光标 - 已禁用
  destroyVirtualCursor() {
    // 无需操作
  }

  // 更新虚拟光标位置 - 已禁用
  updateVirtualCursorPosition(x, y) {
    // 无需操作，使用远程视频中的光标反馈
  }
  
  // 更新虚拟光标状态 - 已禁用
  updateVirtualCursorState(state) {
    // 无需操作，使用远程视频中的光标反馈
  }

  // 隐藏视频区域的原生光标
  hideVideoAreaCursor() {
    if (this.dom.remoteVideo) {
      this.dom.remoteVideo.style.cursor = 'none';
      this.dom.remoteVideo.parentElement.style.cursor = 'none';
    }
    
    // 添加全局鼠标模式标记（用于样式控制，但不隐藏整个页面光标）
    document.body.classList.add('global-mouse-mode');
  }

  // 显示视频区域的原生光标
  showVideoAreaCursor() {
    if (this.dom.remoteVideo) {
      this.dom.remoteVideo.style.cursor = '';
      this.dom.remoteVideo.parentElement.style.cursor = '';
    }
    
    // 移除全局鼠标模式标记
    document.body.classList.remove('global-mouse-mode');
  }

  // 处理全局鼠标移动
  handleGlobalMouseMove(data) {
    if (!this.globalMouseMode || !this.isControlEnabled) return;
    
    const { x, y, previousX, previousY, timestamp } = data;
    
    // 检查鼠标是否在视频区域内
    const videoRect = this.dom.remoteVideo.getBoundingClientRect();
    const relativeX = x - videoRect.left;
    const relativeY = y - videoRect.top;
    
    const isInVideoArea = relativeX >= 0 && relativeX <= videoRect.width && 
                         relativeY >= 0 && relativeY <= videoRect.height;
    
    if (isInVideoArea) {
      // 计算相对于视频的坐标
      const videoCoords = this.calculateGlobalMouseToVideoCoords(relativeX, relativeY);
      
      if (videoCoords.valid) {
        // 发送远程控制命令
        this.sendGlobalMouseMove(videoCoords, data);
      }
    }
    
    this.lastGlobalMousePosition = { x, y };
  }

  // 计算全局鼠标坐标到视频坐标的转换
  calculateGlobalMouseToVideoCoords(relativeX, relativeY) {
    const video = this.dom.remoteVideo;
    
    if (!video.videoWidth || !video.videoHeight) {
      return { x: 0, y: 0, valid: false };
    }
    
    const rect = video.getBoundingClientRect();
    const videoAspectRatio = video.videoWidth / video.videoHeight;
    const containerAspectRatio = rect.width / rect.height;
    
    // 计算视频在容器中的实际显示区域
    let videoDisplayWidth, videoDisplayHeight, offsetX, offsetY;
    
    if (videoAspectRatio > containerAspectRatio) {
      videoDisplayWidth = rect.width;
      videoDisplayHeight = rect.width / videoAspectRatio;
      offsetX = 0;
      offsetY = (rect.height - videoDisplayHeight) / 2;
    } else {
      videoDisplayWidth = rect.height * videoAspectRatio;
      videoDisplayHeight = rect.height;
      offsetX = (rect.width - videoDisplayWidth) / 2;
      offsetY = 0;
    }
    
    // 检查是否在视频显示区域内
    const videoRelativeX = relativeX - offsetX;
    const videoRelativeY = relativeY - offsetY;
    
    const valid = videoRelativeX >= 0 && videoRelativeX <= videoDisplayWidth && 
                  videoRelativeY >= 0 && videoRelativeY <= videoDisplayHeight;
    
    if (!valid) {
      return { x: 0, y: 0, valid: false };
    }
    
    // 转换为视频原始分辨率的坐标
    const scaleX = video.videoWidth / videoDisplayWidth;
    const scaleY = video.videoHeight / videoDisplayHeight;
    
    let x = videoRelativeX * scaleX;
    let y = videoRelativeY * scaleY;
    
    // 应用窗口共享的坐标转换（如果需要）
    const screenInfo = this.getRemoteScreenInfo();
    if (screenInfo && this.isWindowShare(screenInfo)) {
      let offsetX = 0, offsetY = 0;
      
      if (screenInfo.actualWindowBounds) {
        offsetX = screenInfo.actualWindowBounds.x;
        offsetY = screenInfo.actualWindowBounds.y;
      } else if (screenInfo.windowBounds) {
        offsetX = screenInfo.windowBounds.x;
        offsetY = screenInfo.windowBounds.y;
      } else {
        offsetX = screenInfo.bounds.x;
        offsetY = screenInfo.bounds.y;
      }
      
      x += offsetX;
      y += offsetY;
    }
    
    return { x: Math.round(x), y: Math.round(y), valid: true };
  }

  // 发送全局鼠标移动命令
  sendGlobalMouseMove(coords, globalData) {
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;
    
    const screenInfo = this.getRemoteScreenInfo();
    if (!screenInfo) return;
    
    const command = {
      type: 'mousemove',
      x: coords.x,
      y: coords.y,
      globalPosition: { x: globalData.x, y: globalData.y },
      clientPlatform: window.electronAPI.platform,
      videoResolution: {
        width: this.dom.remoteVideo.videoWidth,
        height: this.dom.remoteVideo.videoHeight
      },
      screenInfo: screenInfo,
      source: 'global-mouse' // 标记来源
    };
    
    p2p.sendControlCommand(command);
  }

  // 处理光标可见性变化 - 已简化
  handleCursorVisibilityChanged(data) {
    console.log('[光标可见性] 状态变化:', data);
    // 无需操作，使用远程视频中的光标反馈
  }

  // 更新全局鼠标按钮状态
  updateGlobalMouseButton(isActive) {
    const button = document.getElementById('globalMouseToggle');
    if (button) {
      const textSpan = button.querySelector('.btn-text');
      const iconSpan = button.querySelector('.btn-icon');
      
      if (textSpan) {
        textSpan.textContent = isActive ? '停止全局' : '全局鼠标';
      }
      if (iconSpan) {
        iconSpan.textContent = isActive ? '⏹️' : '🖱️';
      }
      
      if (isActive) {
        button.classList.add('danger');
        button.classList.remove('global-mouse-toggle');
      } else {
        button.classList.remove('danger');
        button.classList.add('global-mouse-toggle');
      }
    }
  }

  // 新增：启用指针锁定
  async enablePointerLock() {
    try {
      if (!this.dom.videoContainer) {
        console.error('[指针锁定] 视频容器不存在');
        return;
      }

      // 请求指针锁定
      const requestPointerLock = this.dom.videoContainer.requestPointerLock || 
                                this.dom.videoContainer.mozRequestPointerLock || 
                                this.dom.videoContainer.webkitRequestPointerLock;

      if (requestPointerLock) {
        await requestPointerLock.call(this.dom.videoContainer);
                 console.log('[指针锁定] 已启用');
         
         // 绑定指针锁定事件
         this.bindPointerLockEvents();
         
         // 添加指针锁定样式
         this.dom.videoContainer.classList.add('pointer-locked');
         
         // 隐藏提示
         if (this.dom.pointerLockHint) {
           this.dom.pointerLockHint.classList.remove('show');
         }
         
         this.updateAppStatus('指针锁定已启用 - 鼠标被限制在视频区域内');
      } else {
        console.warn('[指针锁定] 浏览器不支持Pointer Lock API');
        this.updateAppStatus('浏览器不支持指针锁定，使用普通模式');
      }
    } catch (error) {
      console.error('[指针锁定] 启用失败:', error);
    }
  }

  // 新增：禁用指针锁定
  async disablePointerLock() {
    try {
      const exitPointerLock = document.exitPointerLock || 
                             document.mozExitPointerLock || 
                             document.webkitExitPointerLock;

      if (exitPointerLock && document.pointerLockElement) {
        exitPointerLock.call(document);
        console.log('[指针锁定] 已禁用');
      }

             // 移除指针锁定样式
       if (this.dom.videoContainer) {
         this.dom.videoContainer.classList.remove('pointer-locked');
       }

       // 移除指针锁定事件
       this.unbindPointerLockEvents();
      
      this.updateAppStatus('指针锁定已禁用');
    } catch (error) {
      console.error('[指针锁定] 禁用失败:', error);
    }
  }

  // 新增：绑定指针锁定相关事件
  bindPointerLockEvents() {
         // 指针锁定状态变化监听
     this.pointerLockChangeHandler = () => {
       const isLocked = document.pointerLockElement === this.dom.videoContainer;
       console.log('[指针锁定] 状态变化:', isLocked ? '已锁定' : '已解锁');
       
       if (!isLocked && this.isControlEnabled) {
         // 如果意外失去锁定，显示提示
         this.updateAppStatus('指针锁定已失去 - 点击视频区域重新锁定');
         
         // 重置虚拟鼠标位置
         this.virtualMousePosition = null;
         
         // 自动重新请求锁定（可选）
         setTimeout(() => {
           if (this.isControlEnabled && !this.globalMouseMode) {
             this.enablePointerLock();
           }
         }, 100);
       }
     };

    // 指针锁定错误监听
    this.pointerLockErrorHandler = () => {
      console.error('[指针锁定] 请求失败');
      this.updateAppStatus('指针锁定请求失败 - 请手动点击视频区域');
    };

         // 监听鼠标移动事件（指针锁定模式下使用movementX/Y）
     this.pointerLockMouseMoveHandler = (event) => {
       if (!this.isControlEnabled || this.globalMouseMode) return;
       
       // 在指针锁定模式下，使用相对移动量
       const movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
       const movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;
       
       if (movementX !== 0 || movementY !== 0) {
         this.handlePointerLockMouseMove(movementX, movementY);
       }
     };

     // 指针锁定模式下的键盘事件处理（主要处理ESC键）
     this.pointerLockKeyDownHandler = (event) => {
       if (!this.isControlEnabled) return;
       
       // 在指针锁定模式下，ESC键用于退出指针锁定和控制模式
       if (event.key === 'Escape') {
         event.preventDefault();
         event.stopPropagation();
         console.log('[指针锁定] ESC键退出控制模式');
         this.updateAppStatus('ESC键退出指针锁定和控制模式');
         this.toggleRemoteControl();
         return;
       }
     };

    // 绑定事件
    document.addEventListener('pointerlockchange', this.pointerLockChangeHandler);
    document.addEventListener('pointerlockerror', this.pointerLockErrorHandler);
    
    // 兼容性事件
    document.addEventListener('mozpointerlockchange', this.pointerLockChangeHandler);
    document.addEventListener('webkitpointerlockchange', this.pointerLockChangeHandler);
    document.addEventListener('mozpointerlockerror', this.pointerLockErrorHandler);
    document.addEventListener('webkitpointerlockerror', this.pointerLockErrorHandler);
    
         if (this.dom.videoContainer) {
       this.dom.videoContainer.addEventListener('mousemove', this.pointerLockMouseMoveHandler, { passive: false });
       // 在指针锁定模式下，为视频容器添加键盘事件监听（用于处理ESC键）
       this.dom.videoContainer.addEventListener('keydown', this.pointerLockKeyDownHandler, { passive: false });
     }
  }

  // 新增：移除指针锁定事件
  unbindPointerLockEvents() {
    if (this.pointerLockChangeHandler) {
      document.removeEventListener('pointerlockchange', this.pointerLockChangeHandler);
      document.removeEventListener('mozpointerlockchange', this.pointerLockChangeHandler);
      document.removeEventListener('webkitpointerlockchange', this.pointerLockChangeHandler);
    }

    if (this.pointerLockErrorHandler) {
      document.removeEventListener('pointerlockerror', this.pointerLockErrorHandler);
      document.removeEventListener('mozpointerlockerror', this.pointerLockErrorHandler);
      document.removeEventListener('webkitpointerlockerror', this.pointerLockErrorHandler);
    }

         if (this.pointerLockMouseMoveHandler && this.dom.videoContainer) {
       this.dom.videoContainer.removeEventListener('mousemove', this.pointerLockMouseMoveHandler);
     }

     if (this.pointerLockKeyDownHandler && this.dom.videoContainer) {
       this.dom.videoContainer.removeEventListener('keydown', this.pointerLockKeyDownHandler);
     }

     // 清理引用
     this.pointerLockChangeHandler = null;
     this.pointerLockErrorHandler = null;
     this.pointerLockMouseMoveHandler = null;
     this.pointerLockKeyDownHandler = null;
  }

  // 新增：处理指针锁定模式下的鼠标移动
  handlePointerLockMouseMove(movementX, movementY) {
    // 累积相对移动量到虚拟鼠标位置
    if (!this.virtualMousePosition) {
      // 初始化虚拟鼠标位置为视频中心
      const videoRect = this.dom.remoteVideo.getBoundingClientRect();
      this.virtualMousePosition = {
        x: videoRect.width / 2,
        y: videoRect.height / 2
      };
    }

    // 更新虚拟鼠标位置
    this.virtualMousePosition.x += movementX;
    this.virtualMousePosition.y += movementY;

    // 限制在视频边界内
    const videoRect = this.dom.remoteVideo.getBoundingClientRect();
    this.virtualMousePosition.x = Math.max(0, Math.min(videoRect.width, this.virtualMousePosition.x));
    this.virtualMousePosition.y = Math.max(0, Math.min(videoRect.height, this.virtualMousePosition.y));

    // 转换为远程坐标并发送
    const coords = this.calculateVideoToRemoteCoords(this.virtualMousePosition.x, this.virtualMousePosition.y);
    
    if (coords.valid) {
      this.sendMouseCommand('mousemove', coords);
    }
  }

  // 新增：计算视频坐标到远程坐标的转换（复用现有逻辑）
  calculateVideoToRemoteCoords(videoX, videoY) {
    const video = this.dom.remoteVideo;
    
    if (!video.videoWidth || !video.videoHeight) {
      return { x: 0, y: 0, valid: false };
    }
    
    const rect = video.getBoundingClientRect();
    const videoAspectRatio = video.videoWidth / video.videoHeight;
    const containerAspectRatio = rect.width / rect.height;
    
    // 计算视频在容器中的实际显示区域
    let videoDisplayWidth, videoDisplayHeight, offsetX, offsetY;
    
    if (videoAspectRatio > containerAspectRatio) {
      videoDisplayWidth = rect.width;
      videoDisplayHeight = rect.width / videoAspectRatio;
      offsetX = 0;
      offsetY = (rect.height - videoDisplayHeight) / 2;
    } else {
      videoDisplayWidth = rect.height * videoAspectRatio;
      videoDisplayHeight = rect.height;
      offsetX = (rect.width - videoDisplayWidth) / 2;
      offsetY = 0;
    }
    
    // 转换为视频显示区域内的坐标
    const videoRelativeX = videoX - offsetX;
    const videoRelativeY = videoY - offsetY;
    
    const valid = videoRelativeX >= 0 && videoRelativeX <= videoDisplayWidth && 
                  videoRelativeY >= 0 && videoRelativeY <= videoDisplayHeight;
    
    if (!valid) {
      return { x: 0, y: 0, valid: false };
    }
    
    // 转换为视频原始分辨率的坐标
    const scaleX = video.videoWidth / videoDisplayWidth;
    const scaleY = video.videoHeight / videoDisplayHeight;
    
    let x = videoRelativeX * scaleX;
    let y = videoRelativeY * scaleY;
    
    // 应用窗口共享的坐标转换（如果需要）
    const screenInfo = this.getRemoteScreenInfo();
    if (screenInfo && this.isWindowShare(screenInfo)) {
      let offsetX = 0, offsetY = 0;
      
      if (screenInfo.actualWindowBounds) {
        offsetX = screenInfo.actualWindowBounds.x;
        offsetY = screenInfo.actualWindowBounds.y;
      } else if (screenInfo.windowBounds) {
        offsetX = screenInfo.windowBounds.x;
        offsetY = screenInfo.windowBounds.y;
      } else {
        offsetX = screenInfo.bounds.x;
        offsetY = screenInfo.bounds.y;
      }
      
      x += offsetX;
      y += offsetY;
    }
    
    return { x: Math.round(x), y: Math.round(y), valid: true };
  }

  // 新增：发送鼠标命令的通用方法
  sendMouseCommand(type, coords, extra = {}) {
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;
    
    const screenInfo = this.getRemoteScreenInfo();
    if (!screenInfo) return;
    
    const command = {
      type: type,
      x: coords.x,
      y: coords.y,
      clientPlatform: window.electronAPI.platform,
      videoResolution: {
        width: this.dom.remoteVideo.videoWidth,
        height: this.dom.remoteVideo.videoHeight
      },
      screenInfo: screenInfo,
      source: 'pointer-lock', // 标记来源
      ...extra
    };
    
    p2p.sendControlCommand(command);
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  const app = new ScreenShareApp();
  
  // 绑定全局鼠标控制按钮事件
  const globalMouseToggle = document.getElementById('globalMouseToggle');
  if (globalMouseToggle) {
    globalMouseToggle.addEventListener('click', () => {
      app.toggleGlobalMouseMode();
    });
  }
}); 