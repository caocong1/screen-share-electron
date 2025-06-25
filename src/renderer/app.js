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
    };
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
        if (this.dom.remoteVideo.requestFullscreen) {
            this.dom.remoteVideo.requestFullscreen();
        }
      },
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
        this.dom.remoteVideo.onmousemove = this.handleRemoteMouseMove.bind(this);
        this.dom.remoteVideo.onclick = this.handleRemoteMouseClick.bind(this);
        this.dom.remoteVideo.onwheel = this.handleRemoteMouseWheel.bind(this);
    } else {
        console.error(`[UI BINDING] 关键元素未找到: #remoteVideo`);
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
      
      console.log('获取到的屏幕源:', sources); // 增加日志，方便调试

      this.dom.screenSources.innerHTML = ''; // 清空"加载中"提示

      if (!sources || sources.length === 0) {
        this.dom.screenSources.innerHTML = '<p>未能获取到屏幕或窗口源。</p>';
        return;
      }

      sources.forEach(source => {
        if (!source || !source.id || !source.name || !source.thumbnail) {
            console.warn('发现一个无效的屏幕源对象，已跳过:', source);
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
      this.dom.startScreenShare.textContent = '停止分享';
      this.dom.startScreenShare.onclick = this.stopSharing.bind(this);
      
      this.signal.send({ type: 'announce-host' });
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
    this.dom.startScreenShare.textContent = '开始屏幕分享';
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
      hosts.forEach(host => {
          const user = this.allUsers.get(host.id);
          if (user) {
              user.isHosting = host.isHosting !== false;
              user.name = host.name;
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
          <button class="connect-btn${!user.isHosting ? ' disabled' : ''}" ${!user.isHosting ? 'disabled' : ''}>观看</button>
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
    });
    p2p.addEventListener('close', () => this.showPanel('guestPanel'));
    
    // 为观看端也添加控制事件监听器（虽然通常不会接收控制指令，但确保控制通道正常工作）
    p2p.addEventListener('control', ({ detail: command }) => {
      console.log('[观看端] 接收到控制反馈:', command);
      // 观看端通常不需要处理控制指令，但这里可以处理一些状态反馈
    });

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
    this.isControlEnabled = !this.isControlEnabled;
    this.dom.toggleControl.textContent = this.isControlEnabled ? '✅ 已启用控制' : '🎮 启用控制';
    this.dom.toggleControl.classList.toggle('active', this.isControlEnabled);
    this.updateAppStatus(this.isControlEnabled ? '远程控制已启用' : '远程控制已禁用');
  }

  // 计算视频坐标到屏幕坐标的映射
  calculateVideoCoordinates(e) {
    const video = this.dom.remoteVideo;
    const rect = video.getBoundingClientRect();
    const videoRatio = video.videoWidth / video.videoHeight;
    const rectRatio = rect.width / rect.height;

    let scale, offsetX, offsetY;
    if (videoRatio > rectRatio) {
      scale = video.videoWidth / rect.width;
      offsetX = 0;
      offsetY = (rect.height - video.videoHeight / scale) / 2;
    } else {
      scale = video.videoHeight / rect.height;
      offsetX = (rect.width - video.videoWidth / scale) / 2;
      offsetY = 0;
    }

    const x = (e.clientX - rect.left - offsetX) * scale;
    const y = (e.clientY - rect.top - offsetY) * scale;

    return { x, y, valid: x >= 0 && x <= video.videoWidth && y >= 0 && y <= video.videoHeight };
  }
  
  handleRemoteMouseMove(e) {
    if (!this.isControlEnabled) return;
    const p2p = this.p2pConnections.values().next().value; // 假设只连接一个
    if (!p2p) return;

    const coords = this.calculateVideoCoordinates(e);
    if (coords.valid) {
      p2p.sendControlCommand({ type: 'mousemove', x: coords.x, y: coords.y });
    }
  }
  
  handleRemoteMouseClick(e) {
    if (!this.isControlEnabled) return;
    const p2p = this.p2pConnections.values().next().value;
    if (!p2p) return;

    const coords = this.calculateVideoCoordinates(e);
    if (coords.valid) {
      p2p.sendControlCommand({ type: 'mouseclick', button: 'left', x: coords.x, y: coords.y });
    }
  }
  
  handleRemoteMouseWheel(e) {
    if (!this.isControlEnabled) return;
    const p2p = this.p2pConnections.values().next().value;
    if (p2p) {
      p2p.sendControlCommand({ type: 'scroll', x: -e.deltaX, y: -e.deltaY });
    }
  }

  updateAppStatus(text) {
    this.dom.appStatus.textContent = text;
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  new ScreenShareApp();
}); 