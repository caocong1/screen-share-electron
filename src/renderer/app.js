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
      toggleDebug: document.getElementById('toggleDebug'),
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
      // Debug elements
      debugInfo: document.getElementById('debugInfo'),
      clientPlatform: document.getElementById('clientPlatform'),
      videoSize: document.getElementById('videoSize'),
      mouseCoords: document.getElementById('mouseCoords'),
      calcCoords: document.getElementById('calcCoords'),
      controlStatus: document.getElementById('controlStatus'),
      dragStatus: document.getElementById('dragStatus'),
      remoteInfo: document.getElementById('remoteInfo'),
      // Virtual keyboard elements
      virtualKeyboard: document.getElementById('virtualKeyboard'),
      keyboardClose: document.getElementById('keyboardClose'),
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
    };
    
    // 初始化调试模式
    this.debugMode = false;
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
      toggleDebug: this.toggleDebug.bind(this),
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
        
        // 绑定鼠标事件 - 增强版
        this.dom.remoteVideo.addEventListener('mousemove', this.handleRemoteMouseMove.bind(this), { passive: false });
        this.dom.remoteVideo.addEventListener('mousedown', this.handleRemoteMouseDown.bind(this), { passive: false });
        this.dom.remoteVideo.addEventListener('mouseup', this.handleRemoteMouseUp.bind(this), { passive: false });
        this.dom.remoteVideo.addEventListener('click', this.handleRemoteMouseClick.bind(this), { passive: false });
        this.dom.remoteVideo.addEventListener('dblclick', this.handleRemoteDoubleClick.bind(this), { passive: false });
        this.dom.remoteVideo.addEventListener('wheel', this.handleRemoteMouseWheel.bind(this), { passive: false });
        this.dom.remoteVideo.addEventListener('contextmenu', this.handleRemoteContextMenu.bind(this), { passive: false });
        
        // 键盘事件（需要视频元素有焦点）
        this.dom.remoteVideo.addEventListener('keydown', this.handleRemoteKeyDown.bind(this), { passive: false });
        this.dom.remoteVideo.addEventListener('keyup', this.handleRemoteKeyUp.bind(this), { passive: false });
        this.dom.remoteVideo.tabIndex = 0; // 使视频元素可以获得焦点
        
        // 初始化拖拽状态
        this.dragState = {
          isDragging: false,
          button: null,
          startX: 0,
          startY: 0,
          startTime: 0
        };
        
        // 长按定时器
        this.longPressTimer = null;
        this.longPressDelay = 500; // 500ms判定为长按
        
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
          
          console.log('[SOURCE-SELECT] 选择了源:', {
            id: source.id,
            name: source.name,
            screenInfo: source.screenInfo
          });
          
          this.dom.startScreenShare.disabled = false;
        };
        
        // 构建显示名称，包含屏幕信息
        let displayName = source.name;
        if (source.screenInfo) {
          const { bounds, isPrimary } = source.screenInfo;
          const primaryText = isPrimary ? ' (主屏幕)' : '';
          displayName = `${source.name}${primaryText} - ${bounds.width}×${bounds.height}`;
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
  toggleRemoteControl() {
    // 检查是否有可用的屏幕信息
    const screenInfo = this.getRemoteScreenInfo();
    if (!screenInfo && !this.isControlEnabled) {
      // 如果没有屏幕信息且试图启用控制，给出提示
      console.warn('[远程控制] 屏幕信息尚未就绪，无法启用控制');
      this.updateAppStatus('屏幕信息尚未就绪，请稍后再试');
      return;
    }
    
    this.isControlEnabled = !this.isControlEnabled;
    
    const iconSpan = this.dom.toggleControl.querySelector('.btn-icon');
    const textSpan = this.dom.toggleControl.querySelector('.btn-text');
    
    if (this.isControlEnabled) {
      iconSpan.textContent = '✅';
      textSpan.textContent = '控制已启用';
      this.dom.toggleControl.classList.add('control-enabled');
      // 给整个屏幕视图添加控制启用的样式
      this.dom.screenView.classList.add('control-enabled');
      console.log('[远程控制] 控制已启用，屏幕信息:', screenInfo);
    } else {
      iconSpan.textContent = '🎮';
      textSpan.textContent = '启用控制';
      this.dom.toggleControl.classList.remove('control-enabled');
      this.dom.screenView.classList.remove('control-enabled');
    }
    
    // 更新调试信息
    if (this.dom.controlStatus) {
      this.dom.controlStatus.textContent = this.isControlEnabled ? '启用' : '禁用';
    }
    
    this.updateAppStatus(this.isControlEnabled ? '远程控制已启用' : '远程控制已禁用');
  }

  // 添加调试功能
  async toggleDebug() {
    this.debugMode = !this.debugMode;
    if (this.dom.debugInfo) {
      this.dom.debugInfo.style.display = this.debugMode ? 'block' : 'none';
    }
    
    // 更新视频尺寸信息
    if (this.debugMode && this.dom.remoteVideo && this.dom.videoSize) {
      const updateVideoSize = () => {
        this.dom.videoSize.textContent = `${this.dom.remoteVideo.videoWidth}×${this.dom.remoteVideo.videoHeight}`;
      };
      
      if (this.dom.remoteVideo.videoWidth) {
        updateVideoSize();
      } else {
        this.dom.remoteVideo.addEventListener('loadedmetadata', updateVideoSize, { once: true });
      }
    }
    
    // 在调试模式下显示系统显示信息
    if (this.debugMode) {
      try {
        const displayInfo = await window.electronAPI.getDisplayInfo();
        console.log('系统显示信息:', displayInfo);
        
        // 更新调试面板信息
        if (this.dom.clientPlatform) {
          this.dom.clientPlatform.textContent = window.electronAPI.platform;
        }
        
        // 显示当前选中屏幕的信息
        if (this.selectedScreenInfo) {
          console.log('当前选中屏幕信息:', this.selectedScreenInfo);
          if (this.dom.remoteInfo) {
            const info = `缩放:${this.selectedScreenInfo.scaleFactor}x 分辨率:${this.selectedScreenInfo.bounds.width}×${this.selectedScreenInfo.bounds.height}`;
            this.dom.remoteInfo.textContent = info;
          }
        }
        
        // 输出完整的调试状态
        this.printDebugStatus();
      } catch (error) {
        console.error('获取显示信息失败:', error);
      }
    }
    
    console.log(`调试模式${this.debugMode ? '已启用' : '已禁用'}`);
    return this.debugMode;
  }

  // 新增：输出完整的调试状态
  printDebugStatus() {
    console.log('=== 调试状态报告 ===');
    console.log('1. 基本信息:', {
      userId: this.userId,
      isHost: !!this.localStream,
      debugMode: this.debugMode,
      isControlEnabled: this.isControlEnabled
    });
    
    console.log('2. P2P连接:', {
      connectionCount: this.p2pConnections.size,
      connections: Array.from(this.p2pConnections.entries()).map(([id, p2p]) => ({
        remoteId: id,
        isConnected: p2p.isConnected,
        isControlEnabled: p2p.isControlEnabled,
        hasRemoteScreenInfo: !!p2p.remoteScreenInfo,
        remoteScreenInfo: p2p.remoteScreenInfo
      }))
    });
    
    console.log('3. 用户列表:', {
      allUsersCount: this.allUsers?.size || 0,
      users: this.allUsers ? Array.from(this.allUsers.entries()).map(([id, user]) => ({
        id,
        isHosting: user.isHosting,
        hasScreenInfo: !!user.screenInfo,
        screenInfo: user.screenInfo
      })) : []
    });
    
    console.log('4. 屏幕信息:', {
      selectedScreenInfo: this.selectedScreenInfo,
      remoteScreenInfo: this.getRemoteScreenInfo()
    });
    
    console.log('5. UI状态:', {
      currentPanel: this.dom.screenView?.style.display !== 'none' ? 'screenView' : 'other',
      controlButtonDisabled: this.dom.toggleControl?.disabled,
      controlButtonTitle: this.dom.toggleControl?.title
    });
    
    console.log('=== 调试状态报告结束 ===');
  }

  // 改进的坐标计算函数
  calculateVideoCoordinates(e) {
    const video = this.dom.remoteVideo;
    
    // 确保视频已加载
    if (!video.videoWidth || !video.videoHeight) {
      console.warn('[坐标计算] 视频尺寸未就绪:', { videoWidth: video.videoWidth, videoHeight: video.videoHeight });
      return { x: 0, y: 0, valid: false };
    }

    const rect = video.getBoundingClientRect();
    const videoAspectRatio = video.videoWidth / video.videoHeight;
    const containerAspectRatio = rect.width / rect.height;

    if (this.debugMode) {
      console.log('[坐标计算] 视频信息:', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        videoAspectRatio,
        containerWidth: rect.width,
        containerHeight: rect.height,
        containerAspectRatio,
        mouseClientX: e.clientX,
        mouseClientY: e.clientY,
        rectLeft: rect.left,
        rectTop: rect.top
      });
    }

    // 计算视频在容器中的实际显示区域
    let videoDisplayWidth, videoDisplayHeight, offsetX, offsetY;
    
    if (videoAspectRatio > containerAspectRatio) {
      // 视频更宽，以宽度为准，高度居中
      videoDisplayWidth = rect.width;
      videoDisplayHeight = rect.width / videoAspectRatio;
      offsetX = 0;
      offsetY = (rect.height - videoDisplayHeight) / 2;
    } else {
      // 视频更高，以高度为准，宽度居中
      videoDisplayWidth = rect.height * videoAspectRatio;
      videoDisplayHeight = rect.height;
      offsetX = (rect.width - videoDisplayWidth) / 2;
      offsetY = 0;
    }

    // 计算鼠标在视频显示区域中的相对位置
    const relativeX = e.clientX - rect.left - offsetX;
    const relativeY = e.clientY - rect.top - offsetY;

    // 转换为视频原始分辨率的坐标
    const scaleX = video.videoWidth / videoDisplayWidth;
    const scaleY = video.videoHeight / videoDisplayHeight;
    
    const x = relativeX * scaleX;
    const y = relativeY * scaleY;

    const valid = relativeX >= 0 && relativeX <= videoDisplayWidth && 
                  relativeY >= 0 && relativeY <= videoDisplayHeight;

    if (this.debugMode) {
      console.log('[坐标计算] 结果:', {
        videoDisplayWidth,
        videoDisplayHeight,
        offsetX,
        offsetY,
        relativeX,
        relativeY,
        scaleX,
        scaleY,
        finalX: x,
        finalY: y,
        valid
      });
    }

    return { x: Math.round(x), y: Math.round(y), valid };
  }
  
  handleRemoteMouseMove(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // 更新调试信息
    if (this.debugMode && this.dom.mouseCoords && this.dom.calcCoords) {
      this.dom.mouseCoords.textContent = `(${e.clientX}, ${e.clientY})`;
      const coords = this.calculateVideoCoordinates(e);
      this.dom.calcCoords.textContent = `(${coords.x}, ${coords.y}) ${coords.valid ? '✓' : '✗'}`;
      
      // 更新拖拽状态
      if (this.dom.dragStatus) {
        if (this.dragState.isDragging) {
          const duration = Date.now() - this.dragState.startTime;
          this.dom.dragStatus.textContent = `拖拽中 ${this.dragState.button} ${duration}ms`;
        } else {
          this.dom.dragStatus.textContent = '无';
        }
      }
    }
    
    if (!this.isControlEnabled) return;
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;

    // 检查屏幕信息是否可用
    const screenInfo = this.getRemoteScreenInfo();
    if (!screenInfo) {
      console.warn('[鼠标移动] 屏幕信息不可用，跳过控制命令');
      return;
    }

    const coords = this.calculateVideoCoordinates(e);
    if (coords.valid) {
      // 减少日志频率，只在调试模式下每100次打印一次
      if (this.debugMode && Math.random() < 0.01) {
        console.log('[鼠标移动] 发送坐标和屏幕信息:', {
          coords: coords,
          videoResolution: {
            width: this.dom.remoteVideo.videoWidth,
            height: this.dom.remoteVideo.videoHeight
          },
          screenInfo: screenInfo,
          clientPlatform: window.electronAPI.platform
        });
      }
      
      // 基础命令对象
      const command = {
        type: this.dragState.isDragging ? 'mousedrag' : 'mousemove',
        x: coords.x, 
        y: coords.y,
        clientPlatform: window.electronAPI.platform,
        videoResolution: {
          width: this.dom.remoteVideo.videoWidth,
          height: this.dom.remoteVideo.videoHeight
        },
        screenInfo: screenInfo
      };
      
      // 如果正在拖拽，添加拖拽信息
      if (this.dragState.isDragging) {
        command.button = this.dragState.button;
        command.startX = this.dragState.startX;
        command.startY = this.dragState.startY;
      }
      
      p2p.sendControlCommand(command);
    }
  }
  
  handleRemoteMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!this.isControlEnabled) return;
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;

    // 检查屏幕信息是否可用
    const screenInfo = this.getRemoteScreenInfo();
    if (!screenInfo) {
      console.warn('[鼠标按下] 屏幕信息不可用，跳过控制命令');
      return;
    }

    const coords = this.calculateVideoCoordinates(e);
    if (!coords.valid) return;

    // 确定按键类型
    const button = e.button === 0 ? 'left' : e.button === 1 ? 'middle' : 'right';
    
    // 更新拖拽状态
    this.dragState = {
      isDragging: true,
      button: button,
      startX: coords.x,
      startY: coords.y,
      startTime: Date.now()
    };

    // 添加拖拽视觉反馈
    const videoContainer = this.dom.remoteVideo.parentElement;
    if (videoContainer) {
      videoContainer.classList.add('dragging');
    }

    console.log(`[鼠标按下] ${button}键 坐标:`, coords);

    // 设置长按定时器
    this.longPressTimer = setTimeout(() => {
      if (this.dragState.isDragging) {
        console.log('[长按检测] 触发长按');
        const longPressCommand = {
          type: 'longpress',
          button: button,
          x: coords.x,
          y: coords.y,
          clientPlatform: window.electronAPI.platform,
          videoResolution: {
            width: this.dom.remoteVideo.videoWidth,
            height: this.dom.remoteVideo.videoHeight
          },
          screenInfo: screenInfo
        };
        p2p.sendControlCommand(longPressCommand);
      }
    }, this.longPressDelay);

    // 发送鼠标按下事件
    const command = {
      type: 'mousedown',
      button: button,
      x: coords.x,
      y: coords.y,
      clientPlatform: window.electronAPI.platform,
      videoResolution: {
        width: this.dom.remoteVideo.videoWidth,
        height: this.dom.remoteVideo.videoHeight
      },
      screenInfo: screenInfo
    };

    p2p.sendControlCommand(command);
  }

  handleRemoteMouseUp(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!this.isControlEnabled) return;
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;

    // 检查屏幕信息是否可用
    const screenInfo = this.getRemoteScreenInfo();
    if (!screenInfo) {
      console.warn('[鼠标释放] 屏幕信息不可用，跳过控制命令');
      return;
    }

    const coords = this.calculateVideoCoordinates(e);
    if (!coords.valid) return;

    const button = e.button === 0 ? 'left' : e.button === 1 ? 'middle' : 'right';
    const wasDragging = this.dragState.isDragging;
    const dragDuration = Date.now() - this.dragState.startTime;

    console.log(`[鼠标释放] ${button}键 坐标:`, coords, `拖拽:${wasDragging} 时长:${dragDuration}ms`);

    // 清除长按定时器
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    // 发送鼠标释放事件
    const command = {
      type: 'mouseup',
      button: button,
      x: coords.x,
      y: coords.y,
      wasDragging: wasDragging,
      dragDuration: dragDuration,
      clientPlatform: window.electronAPI.platform,
      videoResolution: {
        width: this.dom.remoteVideo.videoWidth,
        height: this.dom.remoteVideo.videoHeight
      },
      screenInfo: screenInfo
    };

    // 如果是拖拽结束，添加拖拽信息
    if (wasDragging) {
      command.startX = this.dragState.startX;
      command.startY = this.dragState.startY;
    }

    p2p.sendControlCommand(command);

    // 重置拖拽状态
    this.dragState.isDragging = false;

    // 移除拖拽视觉反馈
    const videoContainer = this.dom.remoteVideo.parentElement;
    if (videoContainer) {
      videoContainer.classList.remove('dragging');
    }
  }

  handleRemoteMouseClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Click事件在mouseup之后触发，这里主要用于处理简单点击
    // 复杂的交互已经在mousedown/mouseup中处理
    if (this.debugMode) {
      console.log('[鼠标点击] Click事件触发');
    }
  }

  handleRemoteDoubleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!this.isControlEnabled) return;
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;

    // 检查屏幕信息是否可用
    const screenInfo = this.getRemoteScreenInfo();
    if (!screenInfo) {
      console.warn('[双击] 屏幕信息不可用，跳过控制命令');
      return;
    }

    const coords = this.calculateVideoCoordinates(e);
    if (!coords.valid) return;

    const button = e.button === 0 ? 'left' : e.button === 1 ? 'middle' : 'right';
    
    console.log('[双击] 发送坐标:', coords);

    const command = {
      type: 'doubleclick',
      button: button,
      x: coords.x,
      y: coords.y,
      clientPlatform: window.electronAPI.platform,
      videoResolution: {
        width: this.dom.remoteVideo.videoWidth,
        height: this.dom.remoteVideo.videoHeight
      },
      screenInfo: screenInfo
    };

    p2p.sendControlCommand(command);
  }

  handleRemoteContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!this.isControlEnabled) return;
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;

    // 检查屏幕信息是否可用
    const screenInfo = this.getRemoteScreenInfo();
    if (!screenInfo) {
      console.warn('[右键菜单] 屏幕信息不可用，跳过控制命令');
      return;
    }

    const coords = this.calculateVideoCoordinates(e);
    if (!coords.valid) return;

    console.log('[右键菜单] 发送坐标:', coords);

    const command = {
      type: 'contextmenu',
      x: coords.x,
      y: coords.y,
      clientPlatform: window.electronAPI.platform,
      videoResolution: {
        width: this.dom.remoteVideo.videoWidth,
        height: this.dom.remoteVideo.videoHeight
      },
      screenInfo: screenInfo
    };

    p2p.sendControlCommand(command);
  }
  
  handleRemoteMouseWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!this.isControlEnabled) return;
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;

    console.log('[鼠标滚轮] 发送滚动:', { deltaX: e.deltaX, deltaY: e.deltaY });
    
    const command = {
      type: 'scroll',
      x: -e.deltaX,
      y: -e.deltaY,
      clientPlatform: window.electronAPI.platform
    };
    
    p2p.sendControlCommand(command);
  }

  handleRemoteKeyDown(e) {
    if (!this.isControlEnabled) return;
    
    // 某些特殊键需要阻止默认行为
    const specialKeys = ['Tab', 'F5', 'F11', 'F12', 'Alt', 'Control', 'Meta'];
    if (specialKeys.includes(e.key) || e.ctrlKey || e.altKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
    }

    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;

    console.log('[键盘按下]', { key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey });

    const command = {
      type: 'keydown',
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      clientPlatform: window.electronAPI.platform
    };

    p2p.sendControlCommand(command);
  }

  handleRemoteKeyUp(e) {
    if (!this.isControlEnabled) return;
    
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;

    console.log('[键盘释放]', { key: e.key, code: e.code });

    const command = {
      type: 'keyup',
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      clientPlatform: window.electronAPI.platform
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
      this.updatePlatformSpecificShortcuts();
    } else {
      iconSpan.textContent = '⌨️';
      textSpan.textContent = '键盘';
      this.dom.toggleKeyboard.classList.remove('control-enabled');
      this.dom.virtualKeyboard.style.display = 'none';
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
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  new ScreenShareApp();
}); 