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
    this.userId = `user-${Math.random().toString(36).substring(2, 9)}`;
    this.localStream = null;
    this.p2pConnections = new Map(); // remoteId -> P2PConnection
    this.hosts = new Map(); // hostId -> hostInfo
    this.isControlEnabled = false;

    this.initDomElements();
    this.initSignalClient();
    this.bindUIEvents();
    this.initAppStatus();
  }

  initDomElements() {
    this.dom = {
      // 页面
      modeSelection: document.getElementById('modeSelection'),
      hostPanel: document.getElementById('hostPanel'),
      guestPanel: document.getElementById('guestPanel'),
      screenView: document.getElementById('screenView'),
      // 按钮
      hostBtn: document.getElementById('hostBtn'),
      guestBtn: document.getElementById('guestBtn'),
      backFromHost: document.getElementById('backFromHost'),
      backFromGuest: document.getElementById('backFromGuest'),
      startScreenShare: document.getElementById('startScreenShare'),
      refreshHosts: document.getElementById('refreshHosts'),
      toggleControl: document.getElementById('toggleControl'),
      stopViewing: document.getElementById('stopViewing'),
      // 显示区域
      screenSources: document.getElementById('screenSources'),
      participantsList: document.getElementById('participantsList'),
      participantCount: document.getElementById('participantCount'),
      hostsList: document.getElementById('hostsList'),
      remoteVideo: document.getElementById('remoteVideo'),
      // 状态
      connectionStatus: document.getElementById('connectionStatus'),
      networkInfo: document.getElementById('networkInfo'),
      appStatus: document.getElementById('appStatus'),
      versionInfo: document.getElementById('versionInfo'),
      viewTitle: document.getElementById('viewTitle'),
    };
  }

  initSignalClient() {
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
    this.dom.hostBtn.onclick = () => this.showPanel('hostPanel');
    this.dom.guestBtn.onclick = () => this.showPanel('guestPanel');
    this.dom.backFromHost.onclick = () => this.showPanel('modeSelection');
    this.dom.backFromGuest.onclick = () => this.showPanel('modeSelection');
    this.dom.startScreenShare.onclick = this.startSharing.bind(this);
    this.dom.refreshHosts.onclick = () => this.signal.send({ type: 'get-hosts' });
    this.dom.toggleControl.onclick = this.toggleRemoteControl.bind(this);
    this.dom.stopViewing.onclick = this.stopViewing.bind(this);

    // 远程视频交互
    this.dom.remoteVideo.onmousemove = this.handleRemoteMouseMove.bind(this);
    this.dom.remoteVideo.onclick = this.handleRemoteMouseClick.bind(this);
    this.dom.remoteVideo.onwheel = this.handleRemoteMouseWheel.bind(this);
  }

  async initAppStatus() {
    const { versions, getNetworkInfo } = window.electronAPI;
    this.dom.versionInfo.textContent = `Electron v${versions.electron} | Chromium v${versions.chrome}`;
    const netInfo = await getNetworkInfo();
    const ip = netInfo.addresses[0]?.address || 'N/A';
    this.dom.networkInfo.textContent = `${netInfo.hostname} (${ip})`;
    this.userName = netInfo.hostname || this.userId;
  }

  showPanel(panelName) {
    try {
      console.log(`[UI] Switching to panel: ${panelName}`);
      const panels = ['modeSelection', 'hostPanel', 'guestPanel', 'screenView'];

      panels.forEach(p => {
        const panelElement = this.dom[p];
        if (panelElement) {
          const newDisplay = (p === panelName) ? 'block' : 'none';
          panelElement.style.display = newDisplay;
        } else {
          console.error(`[UI] Panel element '${p}' not found in this.dom`);
        }
      });

      if (panelName === 'hostPanel') {
        this.loadScreenSources();
      } else if (panelName === 'guestPanel') {
        this.signal.send({ type: 'get-hosts' });
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
      case 'hosts-list':
        this.updateHostsList(message.hosts);
        break;
      case 'host-online':
        this.hosts.set(message.host.id, message.host);
        this.updateHostsList(Array.from(this.hosts.values()));
        break;
      case 'host-offline':
        this.hosts.delete(message.hostId);
        this.updateHostsList(Array.from(this.hosts.values()));
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
          this.dom.startScreenShare.disabled = false;
        };
        el.innerHTML = `
          <img src="${source.thumbnail}" alt="${source.name}">
          <div class="source-name">${source.name}</div>
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
      
      this.signal.send({ type: 'announce-host', hostName: this.userName });
      this.updateAppStatus(`正在分享屏幕...`);
    } catch (error) {
      console.error('获取媒体流失败:', error);
      alert('无法开始屏幕分享。请检查权限设置。');
    }
  }

  stopSharing() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    this.signal.send({ type: 'stop-hosting' });
    Object.values(this.p2pConnections).forEach(conn => conn.close());
    this.p2pConnections.clear();
    this.dom.startScreenShare.textContent = '开始屏幕分享';
    this.dom.startScreenShare.onclick = this.startSharing.bind(this);
    this.updateAppStatus('就绪');
    this.updateParticipantsList();
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

  // --- 访客逻辑 ---
  updateHostsList(hosts) {
    this.dom.hostsList.innerHTML = '';
    if (hosts.length === 0) {
      this.dom.hostsList.innerHTML = '<p class="no-hosts">暂无可用分享</p>';
      return;
    }
    hosts.forEach(host => {
      this.hosts.set(host.id, host);
      const el = document.createElement('div');
      el.className = 'host-item';
      el.innerHTML = `
        <div class="host-info">
          <div class="host-name">${host.name}</div>
          <div class="host-status">正在分享</div>
        </div>
        <button class="connect-btn">连接</button>
      `;
      el.querySelector('.connect-btn').onclick = () => this.connectToHost(host.id);
      this.dom.hostsList.appendChild(el);
    });
  }

  async connectToHost(hostId) {
    if (this.p2pConnections.has(hostId)) return;
    this.updateAppStatus(`正在连接到 ${hostId}...`);

    const p2p = new P2PConnection(this.userId, hostId);
    this.p2pConnections.set(hostId, p2p);

    p2p.addEventListener('icecandidate', ({ detail: candidate }) => {
      this.signal.send({ type: 'ice-candidate', to: hostId, from: this.userId, data: candidate });
    });
    p2p.addEventListener('stream', ({ detail: stream }) => {
      this.dom.remoteVideo.srcObject = stream;
      this.showPanel('screenView');
      this.dom.viewTitle.textContent = `正在观看 ${this.hosts.get(hostId)?.name || hostId} 的屏幕`;
    });
    p2p.addEventListener('close', () => this.showPanel('guestPanel'));
    p2p.addEventListener('control', ({ detail: command }) => {
      window.electronAPI.sendRemoteControl(command);
    });

    // 这里访客作为 offer 发起方
    const offer = await p2p.createOffer(new MediaStream()); // 发送一个空流
    this.signal.send({ type: 'offer', to: hostId, from: this.userId, data: offer });
  }
  
  stopViewing() {
    this.p2pConnections.forEach(conn => conn.close());
    this.p2pConnections.clear();
    this.dom.remoteVideo.srcObject = null;
    this.showPanel('guestPanel');
  }

  // --- WebRTC 信令处理 ---
  async handleOffer(fromId, offer) {
    if (!this.localStream) return; // 如果没在分享，则忽略

    let p2p = this.p2pConnections.get(fromId);
    if (p2p) {
      p2p.close();
    }
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

    const answer = await p2p.createAnswer(offer);
    // 把本地屏幕流加入连接
    this.localStream.getTracks().forEach(track => p2p.pc.addTrack(track, this.localStream));
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
  
  handleRemoteMouseMove(e) {
    if (!this.isControlEnabled) return;
    const p2p = this.p2pConnections.values().next().value; // 假设只连接一个
    if (!p2p) return;

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

    if (x >= 0 && x <= video.videoWidth && y >= 0 && y <= video.videoHeight) {
      p2p.sendControlCommand({ type: 'mousemove', x, y });
    }
  }
  
  handleRemoteMouseClick(e) {
    if (!this.isControlEnabled) return;
    const p2p = this.p2pConnections.values().next().value;
    if (p2p) {
      p2p.sendControlCommand({ type: 'mouseclick', button: 'left' });
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