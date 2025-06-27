import { config } from "../lib/config.js";
import { P2PConnection } from "../lib/p2p-connection.js";

/**
 * Canvas视频渲染器类
 */
class CanvasVideoRenderer {
	constructor(canvasElement) {
		this.canvas = canvasElement;
		this.ctx = this.canvas.getContext("2d");
		this.video = null;
		this.stream = null;
		this.animationId = null;
		this.isPlaying = false;

		// 绑定事件处理函数
		this.render = this.render.bind(this);
	}

	setStream(stream) {
		this.stream = stream;

		// 创建隐藏的video元素来解码视频流
		if (this.video) {
			this.video.remove();
		}

		this.video = document.createElement("video");
		this.video.style.display = "none";
		this.video.autoplay = true;
		this.video.playsinline = true;
		this.video.muted = true;
		document.body.appendChild(this.video);

		this.video.srcObject = stream;

		this.video.addEventListener("loadedmetadata", () => {
			console.log(
				`[Canvas渲染器] 视频元数据加载完成: ${this.video.videoWidth}x${this.video.videoHeight}`,
			);
			this.updateCanvasSize();
		});

		this.video.addEventListener("play", () => {
			console.log("[Canvas渲染器] 视频开始播放");
			this.isPlaying = true;
			this.startRendering();

			// 触发自定义播放事件
			this.canvas.dispatchEvent(new Event("playing"));
		});

		this.video.addEventListener("pause", () => {
			console.log("[Canvas渲染器] 视频暂停");
			this.isPlaying = false;
			this.stopRendering();
		});
	}

	updateCanvasSize() {
		if (this.video && this.video.videoWidth && this.video.videoHeight) {
			// 保持宽高比的同时调整canvas尺寸
			const aspectRatio = this.video.videoWidth / this.video.videoHeight;
			const containerWidth = this.canvas.parentElement.clientWidth;
			const containerHeight = this.canvas.parentElement.clientHeight;
			const containerAspectRatio = containerWidth / containerHeight;

			if (aspectRatio > containerAspectRatio) {
				// 视频比容器宽，以宽度为准
				this.canvas.style.width = "100%";
				this.canvas.style.height = "auto";
			} else {
				// 视频比容器高，以高度为准
				this.canvas.style.width = "auto";
				this.canvas.style.height = "100%";
			}

			// 设置实际渲染尺寸
			this.canvas.width = this.video.videoWidth;
			this.canvas.height = this.video.videoHeight;

			console.log(
				`[Canvas渲染器] 画布尺寸调整为: ${this.canvas.width}x${this.canvas.height}`,
			);
		}
	}

	startRendering() {
		if (this.animationId) {
			cancelAnimationFrame(this.animationId);
		}
		this.render();
	}

	stopRendering() {
		if (this.animationId) {
			cancelAnimationFrame(this.animationId);
			this.animationId = null;
		}
	}

	render() {
		if (!this.isPlaying || !this.video || this.video.readyState < 2) {
			this.animationId = requestAnimationFrame(this.render);
			return;
		}

		try {
			// 将视频帧绘制到canvas上
			this.ctx.drawImage(
				this.video,
				0,
				0,
				this.canvas.width,
				this.canvas.height,
			);
		} catch (error) {
			console.warn("[Canvas渲染器] 绘制帧失败:", error);
		}

		this.animationId = requestAnimationFrame(this.render);
	}

	get videoWidth() {
		return this.video ? this.video.videoWidth : this.canvas.width;
	}

	get videoHeight() {
		return this.video ? this.video.videoHeight : this.canvas.height;
	}

	destroy() {
		this.stopRendering();
		if (this.video) {
			this.video.srcObject = null;
			this.video.remove();
			this.video = null;
		}
		this.stream = null;
	}
}

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
			console.log("信令服务器已连接");
			this.reconnectAttempts = 0;
			this.dispatchEvent(new Event("open"));
		};

		this.ws.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data);
				this.dispatchEvent(new CustomEvent("message", { detail: message }));
			} catch (error) {
				console.error("解析信令消息失败:", error);
			}
		};

		this.ws.onclose = () => {
			console.warn("与信令服务器的连接已断开");
			this.dispatchEvent(new Event("close"));
			this._reconnect();
		};

		this.ws.onerror = (error) => {
			console.error("信令服务器连接错误:", error);
		};
	}

	send(message) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(message));
		} else {
			console.error("信令连接未打开，无法发送消息:", message);
		}
	}

	_reconnect() {
		if (this.reconnectAttempts < config.signaling.maxReconnectAttempts) {
			this.reconnectAttempts++;
			console.log(`尝试重新连接 (${this.reconnectAttempts})...`);
			setTimeout(() => this.connect(), config.signaling.reconnectInterval);
		} else {
			console.error("已达到最大重连次数，停止重连");
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
		this.isDebugVisible = false;

		// 添加全局键盘监听器的引用
		this.globalKeyDownHandler = null;
		this.globalKeyUpHandler = null;

		// Canvas鼠标事件监听器引用
		this.canvasMouseHandlers = {
			mousemove: null,
			mousedown: null,
			mouseup: null,
			click: null,
			dblclick: null,
			wheel: null,
			contextmenu: null,
		};

		// 鼠标状态跟踪
		this.isDragging = false;
		this.dragButton = null;
		this.virtualMousePosition = null;

		// Canvas视频渲染器
		this.canvasRenderer = null;

		this.initDomElements();
		this.bindUIEvents();
		this.initAppAndConnect();
	}

	initDomElements() {
		this.dom = {
			// Pages
			modeSelection: document.getElementById("modeSelection"),
			hostPanel: document.getElementById("hostPanel"),
			guestPanel: document.getElementById("guestPanel"),
			screenView: document.getElementById("screenView"),
			// Buttons
			hostBtn: document.getElementById("hostBtn"),
			guestBtn: document.getElementById("guestBtn"),
			backFromHost: document.getElementById("backFromHost"),
			backFromGuest: document.getElementById("backFromGuest"),
			startScreenShare: document.getElementById("startScreenShare"),
			refreshUsers: document.getElementById("refreshUsers"),
			toggleControl: document.getElementById("toggleControl"),
			toggleFullscreen: document.getElementById("toggleFullscreen"),
			stopViewing: document.getElementById("stopViewing"),

			// Display Areas
			screenSources: document.getElementById("screenSources"),
			participantsList: document.getElementById("participantsList"),
			participantCount: document.getElementById("participantCount"),
			onlineUsersList: document.getElementById("onlineUsersList"),
			remoteCanvas: document.getElementById("remoteCanvas"),
			videoOverlay: document.getElementById("videoOverlay"),
			// Status
			connectionStatus: document.getElementById("connectionStatus"),
			networkInfo: document.getElementById("networkInfo"),
			appStatus: document.getElementById("appStatus"),
			viewTitle: document.getElementById("viewTitle"),
			// Virtual keyboard elements
			virtualKeyboard: document.getElementById("virtualKeyboard"),
			keyboardClose: document.getElementById("keyboardClose"),
			keyboardNotice: document.getElementById("keyboardNotice"),
			textInput: document.getElementById("textInput"),
			sendText: document.getElementById("sendText"),
			sendEnter: document.getElementById("sendEnter"),
			clearText: document.getElementById("clearText"),
			debugInfo: document.getElementById("debugInfo"),
			// Fullscreen elements
			videoContainer: document.getElementById("videoContainer"),
			fullscreenControls: document.getElementById("fullscreenControls"),
			fullscreenToggleControl: document.getElementById(
				"fullscreenToggleControl",
			),
			fullscreenExitFullscreen: document.getElementById(
				"fullscreenExitFullscreen",
			),
			fullscreenStopViewing: document.getElementById("fullscreenStopViewing"),
			// Pointer lock elements
			pointerLockHint: document.getElementById("pointerLockHint"),
		};

		// 初始化canvas渲染器
		if (this.dom.remoteCanvas) {
			this.canvasRenderer = new CanvasVideoRenderer(this.dom.remoteCanvas);
		}

		window.app = this; // 方便控制台调试
	}

	initSignalClient() {
		if (!this.userId) {
			return;
		}
		const { secure, host, port, path } = config.signaling;
		const signalUrl = `${secure ? "wss" : "ws"}://${host}:${port}${path}`;
		this.signal = new SignalClient(signalUrl);

		this.signal.addEventListener("open", () => {
			this.updateConnectionStatus(true);
			this.signal.send({ type: "register", id: this.userId });
		});

		this.signal.addEventListener("close", () =>
			this.updateConnectionStatus(false),
		);
		this.signal.addEventListener(
			"message",
			this.handleSignalMessage.bind(this),
		);
		this.signal.connect();
	}

	bindUIEvents() {
		const BINDINGS = {
			hostBtn: () => this.showPanel("hostPanel"),
			guestBtn: () => this.showPanel("guestPanel"),
			backFromHost: () => this.showPanel("modeSelection"),
			backFromGuest: () => this.showPanel("modeSelection"),
			startScreenShare: this.startSharing.bind(this),

			toggleControl: this.toggleRemoteControl.bind(this),
			toggleFullscreen: () => {
				this.toggleFullscreen();
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

		if (this.dom.remoteCanvas) {
			// Canvas元素基本设置
			this.dom.remoteCanvas.tabIndex = 0; // 使canvas元素可以获得焦点

			// 禁用选择和拖拽
			this.dom.remoteCanvas.style.userSelect = "none";
			this.dom.remoteCanvas.style.webkitUserSelect = "none";
			this.dom.remoteCanvas.style.pointerEvents = "auto";

			// 设置canvas样式
			this.dom.remoteCanvas.style.maxWidth = "100%";
			this.dom.remoteCanvas.style.maxHeight = "100%";
			this.dom.remoteCanvas.style.objectFit = "contain";
		} else {
			console.error(`[UI BINDING] 关键元素未找到: #remoteCanvas`);
		}

		// 绑定虚拟键盘事件
		this.bindVirtualKeyboardEvents();

		// 绑定全屏事件
		this.bindFullscreenEvents();

		// 绑定Canvas点击事件（用于启用指针锁定）
		if (this.dom.remoteCanvas) {
			this.dom.remoteCanvas.addEventListener("click", () => {
				if (
					this.isControlEnabled &&
					!this.globalMouseMode &&
					!document.pointerLockElement
				) {
					this.enablePointerLock();
				}
			});

			// 鼠标进入时显示提示
			this.dom.remoteCanvas.addEventListener("mouseenter", () => {
				if (
					this.isControlEnabled &&
					!this.globalMouseMode &&
					!document.pointerLockElement &&
					this.dom.pointerLockHint
				) {
					this.dom.pointerLockHint.classList.add("show");
				}
			});

			// 鼠标离开时隐藏提示
			this.dom.remoteCanvas.addEventListener("mouseleave", () => {
				if (this.dom.pointerLockHint) {
					this.dom.pointerLockHint.classList.remove("show");
				}
			});
		}
	}

	async initAppAndConnect() {
		await this.initAppStatus();
		this.initSignalClient();
		this.showPanel("modeSelection");
	}

	async initAppStatus() {
		const { getNetworkInfo } = window.electronAPI;
		const netInfo = await getNetworkInfo();
		const ip =
			netInfo.addresses[0]?.address ||
			`user-${Math.random().toString(36).substring(2, 9)}`;
		this.userId = ip;
		this.dom.networkInfo.textContent = this.userId;
	}

	showPanel(panelName) {
		try {
			console.log(`[UI] Switching to panel: ${panelName}`);
			const panels = ["modeSelection", "hostPanel", "guestPanel", "screenView"];

			panels.forEach((p) => {
				const panelElement = this.dom[p];
				if (panelElement) {
					if (p === panelName) {
						// 根据面板类型设置正确的显示样式
						if (p === "modeSelection") {
							panelElement.style.display = "grid"; // 保持grid布局
						} else {
							panelElement.style.display = "block";
						}
					} else {
						panelElement.style.display = "none";
					}
				} else {
					console.error(`[UI] Panel element '${p}' not found in this.dom`);
				}
			});

			if (panelName === "hostPanel") {
				this.loadScreenSources();
			} else if (panelName === "modeSelection") {
				this.stopSharing();
				this.stopViewing();
				// 切换到主菜单时清理全局键盘监听
				this.disableGlobalKeyboardControl();
			} else if (panelName !== "screenView") {
				// 如果不是屏幕视图，清理全局键盘监听
				this.disableGlobalKeyboardControl();
			}
		} catch (error) {
			console.error(
				`[UI] Error in showPanel while switching to '${panelName}':`,
				error,
			);
			// Optional: Display a user-facing error message
		}
	}

	updateConnectionStatus(isConnected) {
		if (isConnected) {
			this.dom.connectionStatus.textContent = "在线";
			this.dom.connectionStatus.className = "status-indicator online";
		} else {
			this.dom.connectionStatus.textContent = "离线";
			this.dom.connectionStatus.className = "status-indicator offline";
		}
	}

	handleSignalMessage({ detail: message }) {
		console.log("收到信令:", message);
		switch (message.type) {
			case "registered":
				this.userId = message.id; // 服务器可能会分配一个ID
				break;
			case "users-list": // 修改：处理全量用户列表
				this.updateOnlineUsersList(message.users);
				break;
			case "user-online": // 修改：处理单个用户上线
				this.addOnlineUser(message.userId);
				break;
			case "user-offline": // 修改：处理单个用户下线
				this.removeOnlineUser(message.userId);
				break;
			case "hosts-list":
				this.updateHostStatus(message.hosts);
				break;
			case "host-online":
				this.updateHostStatus([message.host]);
				break;
			case "host-offline":
				this.updateHostStatus([{ id: message.hostId, isHosting: false }]);
				break;
			case "offer":
				this.handleOffer(message.from, message.data);
				break;
			case "answer":
				this.handleAnswer(message.from, message.data);
				break;
			case "ice-candidate":
				this.handleIceCandidate(message.from, message.data);
				break;
		}
	}

	// --- 主机逻辑 ---
	async loadScreenSources() {
		try {
			this.dom.screenSources.innerHTML = "<p>正在检查屏幕录制权限...</p>";

			if (window.electronAPI.platform === "darwin") {
				const hasPermission = await window.electronAPI.manageScreenPermission();
				if (!hasPermission) {
					this.dom.screenSources.innerHTML = `<p style="color: red;">屏幕录制权限被拒绝。请在系统设置中授权后，返回主菜单再试。</p>`;
					this.dom.startScreenShare.disabled = true;
					return;
				}
			}

			this.dom.screenSources.innerHTML = "<p>正在获取屏幕源...</p>";
			const sources = await window.electronAPI.getDesktopSources();
			console.log("[LOAD-SOURCES] 源:", sources);

			console.log("[LOAD-SOURCES] 获取到的屏幕源:", sources.length, "个");
			sources.forEach((source, index) => {
				console.log(`[LOAD-SOURCES] 源 ${index}:`, {
					id: source.id,
					name: source.name,
					hasScreenInfo: !!source.screenInfo,
					screenInfo: source.screenInfo,
				});
			});

			this.dom.screenSources.innerHTML = ""; // 清空"加载中"提示

			if (!sources || sources.length === 0) {
				this.dom.screenSources.innerHTML = "<p>未能获取到屏幕或窗口源。</p>";
				return;
			}

			sources.forEach((source, index) => {
				if (!source || !source.id || !source.name || !source.thumbnail) {
					console.warn(`[LOAD-SOURCES] 发现无效的屏幕源 ${index}:`, source);
					return; // 跳过这个无效的源
				}

				const el = document.createElement("div");
				el.className = "screen-source";
				el.onclick = () => {
					if (this.selectedSourceEl) {
						this.selectedSourceEl.classList.remove("selected");
					}
					el.classList.add("selected");
					this.selectedSourceEl = el;
					this.selectedSourceId = source.id;
					this.selectedScreenInfo = source.screenInfo; // 保存屏幕信息
					this.selectedSourceName = source.name; // 保存源名称

					console.log("[SOURCE-SELECT] 选择了屏幕源:", {
						id: source.id,
						name: source.name,
						type: "屏幕",
						screenInfo: source.screenInfo,
					});

					this.dom.startScreenShare.disabled = false;
				};

				// 构建显示名称，包含屏幕信息
				let displayName = source.name;
				if (source.screenInfo) {
					const { bounds, isPrimary } = source.screenInfo;

					// 屏幕源
					const primaryText = isPrimary ? " (主屏幕)" : "";
					const positionText =
						bounds.x !== 0 || bounds.y !== 0
							? ` @(${bounds.x},${bounds.y})`
							: "";
					displayName = `🖥️ ${source.name}${primaryText} - ${bounds.width}×${bounds.height}${positionText}`;
				}

				el.innerHTML = `
          <img src="${source.thumbnail}" alt="${source.name}">
          <div class="source-name">${displayName}</div>
        `;
				this.dom.screenSources.appendChild(el);
			});
		} catch (error) {
			console.error("加载屏幕源时发生严重错误:", error);
			if (this.dom.screenSources) {
				this.dom.screenSources.innerHTML = `<p style="color: red;">加载屏幕源失败。请打开开发者工具 (View > Toggle Developer Tools) 查看 Console 中的详细错误信息。</p>`;
			}
		}
	}

	async startSharing() {
		if (!this.selectedSourceId) {
			alert("请先选择一个要分享的屏幕。");
			return;
		}

		try {
			this.localStream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: {
					mandatory: {
						chromeMediaSource: "desktop",
						chromeMediaSourceId: this.selectedSourceId,
						...config.webrtc.screenVideoConstraints,
					},
				},
			});
			const iconSpan = this.dom.startScreenShare.querySelector(".btn-icon");
			const textSpan = this.dom.startScreenShare.querySelector(".btn-text");
			iconSpan.textContent = "⏹️";
			textSpan.textContent = "停止分享";
			this.dom.startScreenShare.onclick = this.stopSharing.bind(this);

			console.log(
				"[SCREEN-SHARE] 发送主机宣告，屏幕信息:",
				this.selectedScreenInfo,
			);
			this.signal.send({
				type: "announce-host",
				screenInfo: this.selectedScreenInfo,
			});
			this.updateAppStatus(`正在分享屏幕...`);
		} catch (error) {
			console.error("获取媒体流失败:", error);
			alert("无法开始屏幕分享。请检查权限设置。");
		}
	}

	stopSharing() {
		if (!this.localStream) return;

		if (this.localStream) {
			this.localStream.getTracks().forEach((track) => track.stop());
		}
		this.signal.send({ type: "stop-hosting" });
		Object.values(this.p2pConnections).forEach((conn) => conn.close());
		this.p2pConnections.clear();
		const iconSpan = this.dom.startScreenShare.querySelector(".btn-icon");
		const textSpan = this.dom.startScreenShare.querySelector(".btn-text");
		iconSpan.textContent = "▶️";
		textSpan.textContent = "开始屏幕分享";
		this.dom.startScreenShare.onclick = this.startSharing.bind(this);
		this.updateAppStatus("就绪");
		this.updateParticipantsList();

		// 清空选中的屏幕信息
		this.selectedSourceId = null;
		this.selectedScreenInfo = null;
		this.selectedSourceEl = null;
	}

	updateParticipantsList() {
		const count = this.p2pConnections.size;
		this.dom.participantCount.textContent = count;
		this.dom.participantsList.innerHTML = "";
		if (count === 0) {
			this.dom.participantsList.innerHTML = "<li>暂无观看者</li>";
			return;
		}
		for (const remoteId of this.p2pConnections.keys()) {
			const item = document.createElement("li");
			item.className = "participant-item";
			item.innerHTML = `<div class="participant-avatar">${remoteId.charAt(0).toUpperCase()}</div> ${remoteId}`;
			this.dom.participantsList.appendChild(item);
		}
	}

	// --- 访客逻辑 (重构为在线用户列表) ---
	updateOnlineUsersList(users) {
		this.allUsers = new Map();
		users.forEach((id) => this.allUsers.set(id, { id, isHosting: false }));
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
		console.log("[HOST-STATUS] 更新主机状态:", hosts);
		hosts.forEach((host) => {
			const user = this.allUsers.get(host.id);
			if (user) {
				user.isHosting = host.isHosting !== false;
				user.name = host.name;
				// 更新屏幕信息
				if (host.screenInfo) {
					user.screenInfo = host.screenInfo;
					console.log(
						`[HOST-STATUS] 主机 ${host.id} 屏幕信息:`,
						host.screenInfo,
					);
				}
			}
		});
		this.renderUserList();
	}

	renderUserList() {
		const listEl = this.dom.onlineUsersList;
		listEl.innerHTML = "";
		if (!this.allUsers || this.allUsers.size === 0) {
			listEl.innerHTML = '<p class="no-users">暂无其他在线用户</p>';
			return;
		}

		this.allUsers.forEach((user) => {
			if (user.id === this.userId) return; // 不显示自己

			const el = document.createElement("div");
			el.className = "user-item";

			const statusClass = user.isHosting ? "hosting" : "idle";
			const statusText = user.isHosting ? "正在分享" : "在线";

			el.innerHTML = `
        <div class="user-info">
          <div class="user-avatar">${(user.name || user.id).charAt(0).toUpperCase()}</div>
          <div class="user-name">${user.name || user.id}</div>
        </div>
        <div class="user-actions">
          <div class="user-status ${statusClass}">${statusText}</div>
          <button class="connect-btn${!user.isHosting ? " disabled" : ""}" ${!user.isHosting ? "disabled" : ""}>
            <span class="btn-icon">👀</span>
            <span class="btn-text">观看</span>
          </button>
        </div>
      `;
			const connectBtn = el.querySelector(".connect-btn");
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
		this.dom.videoOverlay.style.display = "flex";

		const p2p = new P2PConnection(this.userId, hostId, { isGuest: true });
		this.p2pConnections.set(hostId, p2p);

		// 添加数据通道事件调试
		p2p.addEventListener("controlopen", () => {
			console.log("[VIEWER] 数据通道已打开，等待主机发送屏幕信息...");
		});

		p2p.addEventListener("icecandidate", ({ detail: candidate }) => {
			this.signal.send({
				type: "ice-candidate",
				to: hostId,
				from: this.userId,
				data: candidate,
			});
		});
		p2p.addEventListener("stream", ({ detail: stream }) => {
			if (this.canvasRenderer) {
				this.canvasRenderer.setStream(stream);

				// 监听canvas的playing事件
				this.dom.remoteCanvas.addEventListener("playing", () => {
					this.dom.videoOverlay.style.display = "none";
				});
			}

			this.showPanel("screenView");
			const host = this.allUsers.get(hostId);
			this.dom.viewTitle.textContent = `正在观看 ${host?.name || hostId} 的屏幕`;

			// 初始化时禁用控制按钮，等待屏幕信息就绪
			if (this.dom.toggleControl) {
				this.dom.toggleControl.disabled = true;
				this.dom.toggleControl.title = "等待屏幕信息...";
			}
			this.updateAppStatus("视频流已连接，等待屏幕信息...");
		});
		p2p.addEventListener("close", () => this.showPanel("guestPanel"));

		// 为观看端也添加控制事件监听器（虽然通常不会接收控制指令，但确保控制通道正常工作）
		p2p.addEventListener("control", ({ detail: command }) => {
			console.log("[观看端] 接收到控制反馈:", command);
			// 修复：处理来自主机的屏幕信息
			if (command.type === "screen-info" && command.screenInfo) {
				p2p.remoteScreenInfo = command.screenInfo;
				console.log("[VIEWER] 通过数据通道接收到屏幕信息:", command.screenInfo);

				// 屏幕信息就绪后，启用控制按钮并给出提示
				if (this.dom.toggleControl) {
					this.dom.toggleControl.disabled = false;
					this.dom.toggleControl.title = "点击启用远程控制";
				}
				this.updateAppStatus("屏幕信息已就绪，可以启用远程控制");
			}
			// 观看端通常不需要处理其他控制指令，但这里可以处理一些状态反馈
		});

		// 尝试从主机信息中获取屏幕信息
		const host = this.allUsers.get(hostId);
		console.log("[VIEWER] 连接前检查主机信息:", {
			hostId,
			hasHost: !!host,
			hasScreenInfo: !!host?.screenInfo,
			hostInfo: host,
		});

		if (host && host.screenInfo) {
			p2p.remoteScreenInfo = host.screenInfo;
			console.log(
				`[VIEWER] 连接到主机 ${hostId}，从用户列表获取屏幕信息:`,
				host.screenInfo,
			);

			// 如果从用户列表已经获取到屏幕信息，立即启用控制按钮
			setTimeout(() => {
				if (this.dom.toggleControl) {
					this.dom.toggleControl.disabled = false;
					this.dom.toggleControl.title = "点击启用远程控制";
				}
				this.updateAppStatus("屏幕信息已就绪，可以启用远程控制");
			}, 1000); // 延迟1秒确保UI已更新
		} else {
			console.log(
				`[VIEWER] 连接到主机 ${hostId}，但没有屏幕信息，等待数据通道传递`,
			);
		}

		const offer = await p2p.createOffer(new MediaStream());
		this.signal.send({
			type: "offer",
			to: hostId,
			from: this.userId,
			data: offer,
		});
	}

	stopViewing() {
		if (this.p2pConnections.size === 0) return; // 如果没有在观看，则直接返回

		this.p2pConnections.forEach((conn) => conn.close());
		this.p2pConnections.clear();

		// 清理canvas渲染器
		if (this.canvasRenderer) {
			this.canvasRenderer.destroy();
		}

		this.showPanel("guestPanel");

		// 重置遮罩层状态，为下次连接做准备
		this.dom.videoOverlay.style.display = "flex";

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

		p2p.addEventListener("icecandidate", ({ detail: candidate }) => {
			this.signal.send({
				type: "ice-candidate",
				to: fromId,
				from: this.userId,
				data: candidate,
			});
		});
		p2p.addEventListener("close", () => {
			this.p2pConnections.delete(fromId);
			this.updateParticipantsList();
		});

		// 关键修复：为共享端的连接添加控制指令处理器
		p2p.addEventListener("control", ({ detail: command }) => {
			// 安全检查：确保只有在分享状态下才执行控制
			if (this.localStream) {
				// 添加当前分享屏幕的信息到控制指令
				const enrichedCommand = {
					...command,
					screenInfo: this.selectedScreenInfo,
				};
				window.electronAPI.sendRemoteControl(enrichedCommand);
			}
		});

		// 修复：添加数据通道打开事件监听，主动发送屏幕信息
		p2p.addEventListener("controlopen", () => {
			// 数据通道打开后，主动发送屏幕信息给观看端
			console.log("[HOST] 数据通道已打开，准备发送屏幕信息...");

			// 稍微延迟发送，确保连接稳定
			setTimeout(() => {
				if (this.selectedScreenInfo) {
					console.log("[HOST] 发送屏幕信息给观看端:", this.selectedScreenInfo);
					p2p.sendControlCommand({
						type: "screen-info",
						screenInfo: this.selectedScreenInfo,
					});
				} else {
					console.warn(
						"[HOST] 警告：selectedScreenInfo 为空，无法发送屏幕信息",
					);
				}
			}, 500); // 延迟500ms确保连接稳定
		});

		// 为P2P连接设置屏幕信息
		p2p.remoteScreenInfo = this.selectedScreenInfo;

		const answer = await p2p.createAnswer(offer, this.localStream);
		this.signal.send({
			type: "answer",
			to: fromId,
			from: this.userId,
			data: answer,
		});
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
		this.isControlEnabled = !this.isControlEnabled;

		if (this.isControlEnabled) {
			// 启用远程控制时，启用指针锁定和鼠标事件监听
			await this.enablePointerLock();
			this.bindCanvasMouseEvents();
			this.dom.remoteCanvas.style.cursor = "crosshair";
			this.enableGlobalKeyboardControl();
			this.updateAppStatus("远程控制已启用 - 点击Canvas区域锁定鼠标");
		} else {
			// 停止远程控制时，禁用指针锁定和事件监听
			await this.disablePointerLock();
			this.unbindCanvasMouseEvents();
			this.dom.remoteCanvas.style.cursor = "";
			this.disableGlobalKeyboardControl();
			this.updateAppStatus("远程控制已禁用");
		}

		// 更新按钮状态
		const controlButton = document.getElementById("toggleControl");
		if (controlButton) {
			const textSpan = controlButton.querySelector(".btn-text");
			const iconSpan = controlButton.querySelector(".btn-icon");

			if (textSpan) {
				textSpan.textContent = this.isControlEnabled ? "禁用控制" : "启用控制";
			}
			if (iconSpan) {
				iconSpan.textContent = this.isControlEnabled ? "⏹️" : "🎮";
			}

			if (this.isControlEnabled) {
				controlButton.classList.add("danger");
			} else {
				controlButton.classList.remove("danger");
			}
		}

		console.log(`远程控制已${this.isControlEnabled ? "启用" : "禁用"}`);

		// 显示或隐藏canvas内控制面板
		this.updateCanvasControls();
	}

	// 更新canvas内控制面板的显示状态
	updateCanvasControls() {
		// Canvas控制按钮已移除
	}

	// 调试模式开关
	toggleDebugMode() {
		if (!this.dom.debugInfo) return;

		this.isDebugVisible = !this.isDebugVisible;

		if (this.isDebugVisible) {
			this.dom.debugInfo.style.display = "block";
			this.updateAppStatus("调试模式已启用");
		} else {
			this.dom.debugInfo.style.display = "none";
			this.updateAppStatus("调试模式已禁用");
		}
	}

	// 退出控制模式
	exitControlMode() {
		if (this.isControlEnabled) {
			this.toggleRemoteControl();
		}
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
		document.addEventListener("keydown", this.globalKeyDownHandler, true);
		document.addEventListener("keyup", this.globalKeyUpHandler, true);

		// 更新调试信息
		if (this.dom.globalKeyboardStatus) {
			this.dom.globalKeyboardStatus.textContent = "启用";
		}

		console.log("[全局键盘] 已启用全局键盘监听");
	}

	// 禁用全局键盘控制
	disableGlobalKeyboardControl() {
		if (this.globalKeyDownHandler) {
			document.removeEventListener("keydown", this.globalKeyDownHandler, true);
			this.globalKeyDownHandler = null;
		}

		if (this.globalKeyUpHandler) {
			document.removeEventListener("keyup", this.globalKeyUpHandler, true);
			this.globalKeyUpHandler = null;
		}

		// 更新调试信息
		if (this.dom.globalKeyboardStatus) {
			this.dom.globalKeyboardStatus.textContent = "禁用";
		}

		console.log("[全局键盘] 已禁用全局键盘监听");
	}

	// 检查是否为输入元素
	isInputElement(element) {
		if (!element) return false;

		const inputTypes = ["INPUT", "TEXTAREA", "SELECT"];
		if (inputTypes.includes(element.tagName)) return true;

		// 检查是否为可编辑元素
		if (element.contentEditable === "true") return true;

		// 检查虚拟键盘的文本输入框
		if (element.id === "textInput") return true;

		return false;
	}

	// 全局键盘按下处理器
	handleGlobalKeyDown(e) {
		if (!this.isControlEnabled) return;

		// 特殊处理 ESC 键 - 退出控制模式
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			console.log("[快捷键] ESC键退出控制模式");
			this.updateAppStatus("ESC键退出控制模式");
			this.toggleRemoteControl();
			return;
		}

		// 某些特殊键需要阻止默认行为
		const specialKeys = ["Tab", "F5", "F11", "F12", "Alt", "Control", "Meta"];
		if (specialKeys.includes(e.key) || e.ctrlKey || e.altKey || e.metaKey) {
			e.preventDefault();
			e.stopPropagation();
		}

		const p2p = this.p2pConnections.values().next().value;
		if (!p2p) return;

		console.log("[全局键盘按下]", {
			key: e.key,
			code: e.code,
			ctrlKey: e.ctrlKey,
			altKey: e.altKey,
			shiftKey: e.shiftKey,
			metaKey: e.metaKey,
			target: e.target.tagName,
		});

		const command = {
			type: "keydown",
			key: e.key,
			code: e.code,
			ctrlKey: e.ctrlKey,
			altKey: e.altKey,
			shiftKey: e.shiftKey,
			metaKey: e.metaKey,
			clientPlatform: window.electronAPI.platform,
			source: "global", // 标记这是全局键盘事件
		};

		p2p.sendControlCommand(command);
	}

	// 全局键盘释放处理器
	handleGlobalKeyUp(e) {
		if (!this.isControlEnabled) return;

		const p2p = this.p2pConnections.values().next().value;
		if (!p2p) return;

		console.log("[全局键盘释放]", {
			key: e.key,
			code: e.code,
			target: e.target.tagName,
		});

		const command = {
			type: "keyup",
			key: e.key,
			code: e.code,
			ctrlKey: e.ctrlKey,
			altKey: e.altKey,
			shiftKey: e.shiftKey,
			metaKey: e.metaKey,
			clientPlatform: window.electronAPI.platform,
			source: "global", // 标记这是全局键盘事件
		};

		p2p.sendControlCommand(command);
	}

	// --- 虚拟键盘功能 ---
	toggleVirtualKeyboard() {
		this.isKeyboardVisible = !this.isKeyboardVisible;

		if (this.isKeyboardVisible) {
			this.dom.virtualKeyboard.style.display = "block";

			// 显示全局键盘提示（仅在控制模式启用时）
			if (this.dom.keyboardNotice && this.isControlEnabled) {
				this.dom.keyboardNotice.style.display = "block";
			}

			this.updatePlatformSpecificShortcuts();
		} else {
			this.dom.virtualKeyboard.style.display = "none";

			// 隐藏全局键盘提示
			if (this.dom.keyboardNotice) {
				this.dom.keyboardNotice.style.display = "none";
			}
		}

		this.updateAppStatus(
			this.isKeyboardVisible ? "虚拟键盘已显示" : "虚拟键盘已隐藏",
		);
	}

	updatePlatformSpecificShortcuts() {
		// 根据不同平台更新快捷键显示
		const platform = window.electronAPI.platform;
		const isMac = platform === "darwin";

		// 更新Ctrl/Cmd键
		const modKey = isMac ? "Cmd" : "Ctrl";
		const winKey = isMac ? "Cmd" : "Win";

		// 更新常用快捷键
		if (this.dom.virtualKeyboard) {
			const shortcuts = {
				"copy-shortcut": `${modKey}+C`,
				"paste-shortcut": `${modKey}+V`,
				"cut-shortcut": `${modKey}+X`,
				"undo-shortcut": `${modKey}+Z`,
				"redo-shortcut": `${modKey}+Y`,
				"selectall-shortcut": `${modKey}+A`,
				"save-shortcut": `${modKey}+S`,
				"alttab-shortcut": isMac ? "Cmd+Tab" : "Alt+Tab",
				"taskmgr-shortcut": isMac ? "Cmd+Option+Esc" : "Ctrl+Shift+Esc",
				"lock-shortcut": isMac ? "Cmd+Control+Q" : "Win+L",
				"desktop-shortcut": isMac ? "F11" : "Win+D",
				"run-shortcut": isMac ? "Cmd+Space" : "Win+R",
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
				this.dom.virtualKeyboard.style.display = "none";
				this.updateAppStatus("虚拟键盘已隐藏");
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
				this.dom.textInput.value = "";
				this.dom.textInput.focus();
			};
		}

		// 绑定所有键盘按钮
		if (this.dom.virtualKeyboard) {
			// 快捷键按钮
			this.dom.virtualKeyboard
				.querySelectorAll(".shortcut-key, .system-key")
				.forEach((btn) => {
					btn.onclick = () => {
						const shortcut = btn.dataset.shortcut;
						if (shortcut) {
							this.sendShortcut(shortcut);
						}
					};
				});

			// 功能键按钮
			this.dom.virtualKeyboard
				.querySelectorAll(".function-key")
				.forEach((btn) => {
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
			this.updateAppStatus("未连接到远程主机");
			return;
		}

		// 发送文本
		for (const char of text) {
			const command = {
				type: "keytype",
				text: char,
				clientPlatform: window.electronAPI.platform,
			};
			p2p.sendControlCommand(command);
		}

		// 如果需要发送回车
		if (withEnter) {
			const enterCommand = {
				type: "keydown",
				key: "Enter",
				code: "Enter",
				clientPlatform: window.electronAPI.platform,
			};
			p2p.sendControlCommand(enterCommand);
		}

		this.updateAppStatus(
			`已发送文本: ${text.substring(0, 20)}${text.length > 20 ? "..." : ""}`,
		);
	}

	sendShortcut(shortcut) {
		const p2p = this.p2pConnections.values().next().value;
		if (!p2p) {
			this.updateAppStatus("未连接到远程主机");
			return;
		}

		// 解析快捷键
		const parts = shortcut.toLowerCase().split("+");
		const modifiers = {
			ctrl: false,
			alt: false,
			shift: false,
			meta: false,
		};

		let mainKey = "";

		parts.forEach((part) => {
			switch (part) {
				case "ctrl":
					modifiers.ctrl = true;
					break;
				case "alt":
					modifiers.alt = true;
					break;
				case "shift":
					modifiers.shift = true;
					break;
				case "cmd":
				case "win":
					modifiers.meta = true;
					break;
				default:
					mainKey = part;
			}
		});

		// 发送快捷键
		const command = {
			type: "shortcut",
			key: mainKey,
			ctrlKey: modifiers.ctrl,
			altKey: modifiers.alt,
			shiftKey: modifiers.shift,
			metaKey: modifiers.meta,
			clientPlatform: window.electronAPI.platform,
		};

		p2p.sendControlCommand(command);
		this.updateAppStatus(`已发送快捷键: ${shortcut.toUpperCase()}`);
	}

	sendFunctionKey(key) {
		const p2p = this.p2pConnections.values().next().value;
		if (!p2p) {
			this.updateAppStatus("未连接到远程主机");
			return;
		}

		const command = {
			type: "functionkey",
			key: key,
			clientPlatform: window.electronAPI.platform,
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
		document.addEventListener("fullscreenchange", fullscreenChangeHandler);
		document.addEventListener(
			"webkitfullscreenchange",
			fullscreenChangeHandler,
		);
		document.addEventListener("mozfullscreenchange", fullscreenChangeHandler);
		document.addEventListener("MSFullscreenChange", fullscreenChangeHandler);

		// 绑定全屏控制按钮事件
		if (this.dom.fullscreenToggleControl) {
			this.dom.fullscreenToggleControl.onclick = () => {
				this.toggleRemoteControl();
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
				this.dom.fullscreenControls.classList.add("show");
			}
		};

		const hideControls = () => {
			if (this.dom.fullscreenControls) {
				this.dom.fullscreenControls.classList.remove("show");
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
			const isInControlArea =
				e.clientX > window.innerWidth - edgeSize && e.clientY < edgeSize;

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
			this.dom.videoContainer.addEventListener(
				"mousemove",
				this.fullscreenMouseMoveHandler,
			);
			this.dom.videoContainer.addEventListener(
				"mouseleave",
				this.fullscreenMouseLeaveHandler,
			);
		}

		if (this.dom.fullscreenControls) {
			this.dom.fullscreenControls.addEventListener(
				"mouseenter",
				this.fullscreenControlsMouseEnter,
			);
			this.dom.fullscreenControls.addEventListener(
				"mouseleave",
				this.fullscreenControlsMouseLeave,
			);
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
			this.dom.videoContainer.removeEventListener(
				"mousemove",
				this.fullscreenMouseMoveHandler,
			);
			this.dom.videoContainer.removeEventListener(
				"mouseleave",
				this.fullscreenMouseLeaveHandler,
			);
		}

		if (this.dom.fullscreenControls) {
			this.dom.fullscreenControls.removeEventListener(
				"mouseenter",
				this.fullscreenControlsMouseEnter,
			);
			this.dom.fullscreenControls.removeEventListener(
				"mouseleave",
				this.fullscreenControlsMouseLeave,
			);
		}

		// 隐藏控制面板
		if (this.dom.fullscreenControls) {
			this.dom.fullscreenControls.classList.remove("show");
		}
	}

	updateFullscreenControlsState() {
		if (!this.dom.fullscreenControls || !document.fullscreenElement) return;

		// 更新控制按钮状态
		if (this.dom.fullscreenToggleControl) {
			const icon = this.dom.fullscreenToggleControl.querySelector(".btn-icon");
			if (icon) {
				icon.textContent = this.isControlEnabled ? "✅" : "🎮";
			}
			if (this.isControlEnabled) {
				this.dom.fullscreenToggleControl.classList.add("control-enabled");
			} else {
				this.dom.fullscreenToggleControl.classList.remove("control-enabled");
			}
		}
	}

	// 判断是否为窗口共享（现在只支持屏幕分享，始终返回false）
	isWindowShare(screenInfo) {
		// 由于现在只支持屏幕分享，窗口分享功能已移除
		return false;
	}

	// 获取远程屏幕信息的辅助方法
	getRemoteScreenInfo() {
		console.log("[SCREEN-INFO] 开始获取远程屏幕信息...");

		// 从当前连接的P2P连接中获取远程屏幕信息
		// 这个信息在连接建立时应该被传递
		const p2p = this.p2pConnections.values().next().value;
		console.log("[SCREEN-INFO] P2P连接状态:", {
			hasP2P: !!p2p,
			p2pId: p2p?.remoteId,
			hasRemoteScreenInfo: !!p2p?.remoteScreenInfo,
			remoteScreenInfo: p2p?.remoteScreenInfo,
		});

		if (p2p && p2p.remoteScreenInfo) {
			console.log("[SCREEN-INFO] 从P2P连接获取屏幕信息:", p2p.remoteScreenInfo);
			return p2p.remoteScreenInfo;
		}

		// 如果没有存储的远程屏幕信息，尝试从已知的屏幕信息中获取
		// 这通常发生在作为主机时，使用本地选中的屏幕信息
		if (this.selectedScreenInfo) {
			console.log(
				"[SCREEN-INFO] 使用本地选中屏幕信息:",
				this.selectedScreenInfo,
			);
			return this.selectedScreenInfo;
		}

		// 调试：尝试从allUsers中获取当前连接的主机屏幕信息
		if (p2p && this.allUsers) {
			const host = this.allUsers.get(p2p.remoteId);
			console.log("[SCREEN-INFO] 检查用户列表:", {
				remoteId: p2p.remoteId,
				hasHost: !!host,
				hostInfo: host,
				allUsersSize: this.allUsers.size,
			});

			if (host && host.screenInfo) {
				console.log("[SCREEN-INFO] 从用户列表获取屏幕信息:", host.screenInfo);
				p2p.remoteScreenInfo = host.screenInfo; // 缓存到P2P连接中
				return host.screenInfo;
			} else {
				console.log("[SCREEN-INFO] 用户列表中没有屏幕信息");
			}
		}

		// 兜底返回null，坐标转换函数会处理这种情况
		console.log("[SCREEN-INFO] 警告：没有可用的屏幕信息");
		return null;
	}

	updateAppStatus(text) {
		this.dom.appStatus.textContent = text;
	}

	// 绑定Canvas鼠标事件
	bindCanvasMouseEvents() {
		if (!this.dom.remoteCanvas) return;

		// 鼠标移动事件（在指针锁定模式下使用movementX/Y）
		this.canvasMouseHandlers.mousemove = (event) => {
			if (!this.isControlEnabled) return;

			if (document.pointerLockElement === this.dom.remoteCanvas) {
				// 指针锁定模式 - 使用相对移动量
				const movementX = event.movementX || 0;
				const movementY = event.movementY || 0;

				if (movementX !== 0 || movementY !== 0) {
					this.handlePointerLockMouseMove(movementX, movementY);
				}
			} else {
				// 普通模式 - 使用绝对坐标
				const rect = this.dom.remoteCanvas.getBoundingClientRect();
				const x = event.clientX - rect.left;
				const y = event.clientY - rect.top;
				this.handleCanvasMouseMove(x, y);
			}
		};

		// 鼠标按下事件（仅在普通模式下，非指针锁定模式）
		this.canvasMouseHandlers.mousedown = (event) => {
			// 在指针锁定模式下，不处理canvas的鼠标事件，交给专门的指针锁定处理器
			if (!this.isControlEnabled || document.pointerLockElement) return;
			event.preventDefault();

			this.isDragging = true;
			this.dragButton = event.button;

			const coords = this.getMouseCoords(event);
			if (coords.valid) {
				this.sendMouseCommand("mousedown", coords, {
					button: event.button,
					source: "canvas-normal",
				});
			}

			// 如果不在指针锁定状态，尝试请求锁定
			if (!document.pointerLockElement) {
				this.enablePointerLock();
			}
		};

		// 鼠标释放事件（仅在普通模式下，非指针锁定模式）
		this.canvasMouseHandlers.mouseup = (event) => {
			// 在指针锁定模式下，不处理canvas的鼠标事件，交给专门的指针锁定处理器
			if (!this.isControlEnabled || document.pointerLockElement) return;
			event.preventDefault();

			this.isDragging = false;
			this.dragButton = null;

			const coords = this.getMouseCoords(event);
			if (coords.valid) {
				this.sendMouseCommand("mouseup", coords, {
					button: event.button,
					source: "canvas-normal",
				});
			}
		};

		// 单击事件（仅在普通模式下，非指针锁定模式）
		this.canvasMouseHandlers.click = (event) => {
			// 在指针锁定模式下，不处理canvas的鼠标事件，交给专门的指针锁定处理器
			if (!this.isControlEnabled || document.pointerLockElement) return;
			event.preventDefault();

			console.log("[Canvas鼠标] 收到点击事件:", {
				event: event,
				button: event.button,
				clientX: event.clientX,
				clientY: event.clientY,
				isControlEnabled: this.isControlEnabled,
				pointerLocked: !!document.pointerLockElement,
				mode: "normal",
			});

			const coords = this.getMouseCoords(event);
			console.log("[Canvas鼠标] 坐标计算结果:", {
				coords: coords,
				valid: coords.valid,
			});
			
			if (coords.valid) {
				console.log("[Canvas鼠标] 发送点击命令:", {
					type: "mouseclick",
					coords: coords,
					button: event.button,
					source: "canvas-normal",
				});
				this.sendMouseCommand("mouseclick", coords, {
					button: event.button,
					source: "canvas-normal",
				});
			} else {
				console.warn("[Canvas鼠标] 点击事件坐标无效，跳过发送");
			}
		};

		// 双击事件
		this.canvasMouseHandlers.dblclick = (event) => {
			if (!this.isControlEnabled) return;
			event.preventDefault();

			const coords = this.getMouseCoords(event);
			if (coords.valid) {
				this.sendMouseCommand("doubleclick", coords, { button: event.button });
			}
		};

		// 滚轮事件（仅在普通模式下，非指针锁定模式）
		this.canvasMouseHandlers.wheel = (event) => {
			// 在指针锁定模式下，不处理canvas的wheel事件，交给专门的指针锁定处理器
			if (!this.isControlEnabled || document.pointerLockElement) return;
			event.preventDefault();

			const coords = this.getMouseCoords(event);
			console.log("[Canvas鼠标] 滚轮事件:", {
				coords,
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				deltaZ: event.deltaZ,
				deltaMode: event.deltaMode,
				pointerLocked: !!document.pointerLockElement,
				mode: "normal",
			});
			if (coords.valid) {
				// 发送原始的delta值，让后端处理
				this.sendMouseCommand("scroll", coords, {
					deltaX: event.deltaX,
					deltaY: event.deltaY,
					deltaZ: event.deltaZ,
					deltaMode: event.deltaMode,
					source: "canvas-normal",
					// 保留转换后的值作为备份
					x: event.deltaX * 0.1,
					y: event.deltaY * 0.1,
				});
			}
		};

		// 右键菜单事件
		this.canvasMouseHandlers.contextmenu = (event) => {
			if (this.isControlEnabled) {
				event.preventDefault();

				console.log("[Canvas鼠标] 收到右键菜单事件:", {
					event: event,
					button: event.button,
					clientX: event.clientX,
					clientY: event.clientY,
				});

				// 发送右键菜单命令
				const coords = this.getMouseCoords(event);
				if (coords.valid) {
					console.log("[Canvas鼠标] 发送右键菜单命令:", {
						type: "contextmenu",
						coords: coords,
						button: 2, // 右键
						source: "contextmenu-event",
					});
					this.sendMouseCommand("contextmenu", coords, {
						button: 2, // 右键
						source: "contextmenu-event",
					});
					console.log("[Canvas鼠标] 右键菜单事件:", { coords });
				}
			}
		};

		// 触摸板手势事件（双指缩放等）
		this.canvasMouseHandlers.gesturestart = (event) => {
			if (!this.isControlEnabled) return;
			event.preventDefault();

			const coords = this.getMouseCoords(event);
			if (coords.valid) {
				this.sendMouseCommand("gesturestart", coords, {
					scale: event.scale,
					rotation: event.rotation,
				});
			}
		};

		this.canvasMouseHandlers.gesturechange = (event) => {
			if (!this.isControlEnabled) return;
			event.preventDefault();

			const coords = this.getMouseCoords(event);
			if (coords.valid) {
				this.sendMouseCommand("gesturechange", coords, {
					scale: event.scale,
					rotation: event.rotation,
				});
			}
		};

		this.canvasMouseHandlers.gestureend = (event) => {
			if (!this.isControlEnabled) return;
			event.preventDefault();

			const coords = this.getMouseCoords(event);
			if (coords.valid) {
				this.sendMouseCommand("gestureend", coords, {
					scale: event.scale,
					rotation: event.rotation,
				});
			}
		};

		// 触摸事件支持（移动端/触摸屏）
		this.canvasMouseHandlers.touchstart = (event) => {
			if (!this.isControlEnabled) return;
			event.preventDefault();

			// 处理多点触摸
			for (let i = 0; i < event.touches.length; i++) {
				const touch = event.touches[i];
				const rect = this.dom.remoteCanvas.getBoundingClientRect();
				const x = touch.clientX - rect.left;
				const y = touch.clientY - rect.top;
				const coords = this.calculateCanvasToRemoteCoords(x, y);

				if (coords.valid) {
					this.sendMouseCommand("touchstart", coords, {
						touchId: touch.identifier,
						touchCount: event.touches.length,
						touchIndex: i,
					});
				}
			}
		};

		this.canvasMouseHandlers.touchmove = (event) => {
			if (!this.isControlEnabled) return;
			event.preventDefault();

			// 处理多点触摸移动
			for (let i = 0; i < event.touches.length; i++) {
				const touch = event.touches[i];
				const rect = this.dom.remoteCanvas.getBoundingClientRect();
				const x = touch.clientX - rect.left;
				const y = touch.clientY - rect.top;
				const coords = this.calculateCanvasToRemoteCoords(x, y);

				if (coords.valid) {
					this.sendMouseCommand("touchmove", coords, {
						touchId: touch.identifier,
						touchCount: event.touches.length,
						touchIndex: i,
					});
				}
			}
		};

		this.canvasMouseHandlers.touchend = (event) => {
			if (!this.isControlEnabled) return;
			event.preventDefault();

			// 处理触摸结束
			for (let i = 0; i < event.changedTouches.length; i++) {
				const touch = event.changedTouches[i];
				const rect = this.dom.remoteCanvas.getBoundingClientRect();
				const x = touch.clientX - rect.left;
				const y = touch.clientY - rect.top;
				const coords = this.calculateCanvasToRemoteCoords(x, y);

				if (coords.valid) {
					this.sendMouseCommand("touchend", coords, {
						touchId: touch.identifier,
						touchCount: event.touches.length,
						touchIndex: i,
					});
				}
			}
		};

		// 绑定所有事件
		Object.entries(this.canvasMouseHandlers).forEach(([eventType, handler]) => {
			if (handler) {
				this.dom.remoteCanvas.addEventListener(eventType, handler, {
					passive: false,
				});
			}
		});

		console.log("[Canvas鼠标] 已绑定所有鼠标事件");
	}

	// 解绑Canvas鼠标事件
	unbindCanvasMouseEvents() {
		if (!this.dom.remoteCanvas) return;

		// 解绑所有事件
		Object.entries(this.canvasMouseHandlers).forEach(([eventType, handler]) => {
			if (handler) {
				this.dom.remoteCanvas.removeEventListener(eventType, handler);
			}
		});

		// 清理状态
		this.isDragging = false;
		this.dragButton = null;
		this.virtualMousePosition = null;

		console.log("[Canvas鼠标] 已解绑所有鼠标事件");
	}

	// 处理普通模式下的鼠标移动
	handleCanvasMouseMove(canvasX, canvasY) {
		const coords = this.calculateCanvasToRemoteCoords(canvasX, canvasY);

		if (coords.valid) {
			// 根据拖拽状态发送不同的事件类型
			const eventType = this.isDragging ? "mousedrag" : "mousemove";
			this.sendMouseCommand(eventType, coords, {
				button: this.dragButton,
			});
		}
	}

	// 获取鼠标坐标的统一方法
	getMouseCoords(event) {
		if (document.pointerLockElement === this.dom.remoteCanvas) {
			// 指针锁定模式 - 使用虚拟坐标
			if (this.virtualMousePosition) {
				return this.calculateCanvasToRemoteCoords(
					this.virtualMousePosition.x,
					this.virtualMousePosition.y,
				);
			}
			return { x: 0, y: 0, valid: false };
		} else {
			// 普通模式 - 使用实际坐标
			const rect = this.dom.remoteCanvas.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			return this.calculateCanvasToRemoteCoords(x, y);
		}
	}

	// 计算Canvas坐标到远程坐标的转换
	calculateCanvasToRemoteCoords(canvasX, canvasY) {
		if (
			!this.canvasRenderer ||
			!this.canvasRenderer.videoWidth ||
			!this.canvasRenderer.videoHeight
		) {
			return { x: 0, y: 0, valid: false };
		}

		const canvas = this.dom.remoteCanvas;
		const rect = canvas.getBoundingClientRect();
		const videoAspectRatio =
			this.canvasRenderer.videoWidth / this.canvasRenderer.videoHeight;
		const containerAspectRatio = rect.width / rect.height;

		// 计算视频在canvas中的实际显示区域
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
		const videoRelativeX = canvasX - offsetX;
		const videoRelativeY = canvasY - offsetY;

		const valid =
			videoRelativeX >= 0 &&
			videoRelativeX <= videoDisplayWidth &&
			videoRelativeY >= 0 &&
			videoRelativeY <= videoDisplayHeight;

		if (!valid) {
			return { x: 0, y: 0, valid: false };
		}

		// 转换为视频原始分辨率的坐标
		const scaleX = this.canvasRenderer.videoWidth / videoDisplayWidth;
		const scaleY = this.canvasRenderer.videoHeight / videoDisplayHeight;

		let x = videoRelativeX * scaleX;
		let y = videoRelativeY * scaleY;

		// 应用屏幕偏移（多显示器环境）
		const screenInfo = this.getRemoteScreenInfo();
		if (screenInfo && screenInfo.bounds) {
			// 对于屏幕分享，添加屏幕的偏移坐标（用于多显示器环境）
			const offsetX = screenInfo.bounds.x || 0;
			const offsetY = screenInfo.bounds.y || 0;

			x += offsetX;
			y += offsetY;
		}

		return { x: Math.round(x), y: Math.round(y), valid: true };
	}

	// 新增：启用指针锁定
	async enablePointerLock() {
		try {
			if (!this.dom.remoteCanvas) {
				console.error("[指针锁定] Canvas不存在");
				return;
			}

			// 请求指针锁定
			const requestPointerLock =
				this.dom.remoteCanvas.requestPointerLock ||
				this.dom.remoteCanvas.mozRequestPointerLock ||
				this.dom.remoteCanvas.webkitRequestPointerLock;

			if (requestPointerLock) {
				await requestPointerLock.call(this.dom.remoteCanvas);
				console.log("[指针锁定] 已启用");

				// 绑定指针锁定事件
				this.bindPointerLockEvents();

				// 添加指针锁定样式
				this.dom.remoteCanvas.classList.add("pointer-locked");

				// 隐藏提示
				if (this.dom.pointerLockHint) {
					this.dom.pointerLockHint.classList.remove("show");
				}

				this.updateAppStatus("指针锁定已启用 - 鼠标被限制在Canvas区域内");
			} else {
				console.warn("[指针锁定] 浏览器不支持Pointer Lock API");
				this.updateAppStatus("浏览器不支持指针锁定，使用普通模式");
			}
		} catch (error) {
			console.error("[指针锁定] 启用失败:", error);
		}
	}

	// 新增：禁用指针锁定
	async disablePointerLock() {
		try {
			const exitPointerLock =
				document.exitPointerLock ||
				document.mozExitPointerLock ||
				document.webkitExitPointerLock;

			if (exitPointerLock && document.pointerLockElement) {
				exitPointerLock.call(document);
				console.log("[指针锁定] 已禁用");
			}

			// 移除指针锁定样式
			if (this.dom.remoteCanvas) {
				this.dom.remoteCanvas.classList.remove("pointer-locked");
			}

			// 移除指针锁定事件
			this.unbindPointerLockEvents();

			this.updateAppStatus("指针锁定已禁用");
		} catch (error) {
			console.error("[指针锁定] 禁用失败:", error);
		}
	}

	// 新增：绑定指针锁定相关事件
	bindPointerLockEvents() {
		// 指针锁定状态变化监听
		this.pointerLockChangeHandler = () => {
			const isLocked = document.pointerLockElement === this.dom.remoteCanvas;
			console.log("[指针锁定] 状态变化:", isLocked ? "已锁定" : "已解锁");

			if (!isLocked && this.isControlEnabled) {
				// 如果意外失去锁定，显示提示
				this.updateAppStatus("指针锁定已失去 - 点击视频区域重新锁定");

				// 重置虚拟鼠标位置
				this.virtualMousePosition = null;

				// 自动重新请求锁定（可选）
				setTimeout(() => {
					if (this.isControlEnabled) {
						this.enablePointerLock();
					}
				}, 100);
			}
		};

		// 指针锁定错误监听
		this.pointerLockErrorHandler = () => {
			console.error("[指针锁定] 请求失败");
			this.updateAppStatus("指针锁定请求失败 - 请手动点击视频区域");
		};

		// 监听鼠标移动事件（指针锁定模式下使用movementX/Y）
		this.pointerLockMouseMoveHandler = (event) => {
			if (!this.isControlEnabled) return;

			// 在指针锁定模式下，使用相对移动量
			const movementX =
				event.movementX || event.mozMovementX || event.webkitMovementX || 0;
			const movementY =
				event.movementY || event.mozMovementY || event.webkitMovementY || 0;

			if (movementX !== 0 || movementY !== 0) {
				this.handlePointerLockMouseMove(movementX, movementY);
			}
		};

		// 指针锁定模式下的键盘事件处理（主要处理ESC键）
		this.pointerLockKeyDownHandler = (event) => {
			if (!this.isControlEnabled) return;

			// 在指针锁定模式下，ESC键用于退出指针锁定和控制模式
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				console.log("[指针锁定] ESC键退出控制模式");
				this.updateAppStatus("ESC键退出指针锁定和控制模式");
				this.toggleRemoteControl();
				return;
			}
		};

		// 指针锁定模式下的滚轮事件处理
		this.pointerLockWheelHandler = (event) => {
			// 只在指针锁定模式下处理
			if (!this.isControlEnabled || !document.pointerLockElement) return;

			event.preventDefault();
			event.stopPropagation();

			console.log("[指针锁定] 滚轮事件:", {
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				deltaZ: event.deltaZ,
				deltaMode: event.deltaMode,
				pointerLocked: !!document.pointerLockElement,
				virtualMousePosition: this.virtualMousePosition,
			});

			// 在指针锁定模式下，使用虚拟鼠标位置
			if (this.virtualMousePosition) {
				const coords = this.calculateCanvasToRemoteCoords(
					this.virtualMousePosition.x,
					this.virtualMousePosition.y,
				);

				if (coords.valid) {
					// 发送原始的delta值，让后端处理
					this.sendMouseCommand("scroll", coords, {
						deltaX: event.deltaX,
						deltaY: event.deltaY,
						deltaZ: event.deltaZ,
						deltaMode: event.deltaMode,
						source: "pointer-lock",
						// 保留转换后的值作为备份
						x: event.deltaX * 0.1,
						y: event.deltaY * 0.1,
					});
				}
			}
		};

		// 指针锁定模式下的鼠标按键事件处理
		this.pointerLockMouseDownHandler = (event) => {
			// 只在指针锁定模式下处理
			if (!this.isControlEnabled || !document.pointerLockElement) return;
			event.preventDefault();

			this.isDragging = true;
			this.dragButton = event.button;

			if (this.virtualMousePosition) {
				const coords = this.calculateCanvasToRemoteCoords(
					this.virtualMousePosition.x,
					this.virtualMousePosition.y,
				);
				if (coords.valid) {
					this.sendMouseCommand("mousedown", coords, {
						button: event.button,
						source: "pointer-lock",
					});
				}
			}
		};

		this.pointerLockMouseUpHandler = (event) => {
			// 只在指针锁定模式下处理
			if (!this.isControlEnabled || !document.pointerLockElement) return;
			event.preventDefault();

			this.isDragging = false;
			this.dragButton = null;

			if (this.virtualMousePosition) {
				const coords = this.calculateCanvasToRemoteCoords(
					this.virtualMousePosition.x,
					this.virtualMousePosition.y,
				);
				if (coords.valid) {
					this.sendMouseCommand("mouseup", coords, {
						button: event.button,
						source: "pointer-lock",
					});
				}
			}
		};

		this.pointerLockClickHandler = (event) => {
			// 只在指针锁定模式下处理
			if (!this.isControlEnabled || !document.pointerLockElement) return;
			event.preventDefault();

			console.log("[指针锁定] 收到点击事件:", {
				event: event,
				button: event.button,
				virtualMousePosition: this.virtualMousePosition,
			});

			if (this.virtualMousePosition) {
				const coords = this.calculateCanvasToRemoteCoords(
					this.virtualMousePosition.x,
					this.virtualMousePosition.y,
				);
				if (coords.valid) {
					console.log("[指针锁定] 发送点击命令:", {
						type: "mouseclick",
						coords: coords,
						button: event.button,
						source: "pointer-lock",
					});
					this.sendMouseCommand("mouseclick", coords, {
						button: event.button,
						source: "pointer-lock",
					});
				}
			}
		};

		this.pointerLockContextMenuHandler = (event) => {
			// 只在指针锁定模式下处理
			if (this.isControlEnabled && document.pointerLockElement) {
				event.preventDefault();

				console.log("[指针锁定] 收到右键菜单事件:", {
					event: event,
					button: event.button,
					virtualMousePosition: this.virtualMousePosition,
				});

				// 发送右键菜单命令
				if (this.virtualMousePosition) {
					const coords = this.calculateCanvasToRemoteCoords(
						this.virtualMousePosition.x,
						this.virtualMousePosition.y,
					);
					if (coords.valid) {
						console.log("[指针锁定] 发送右键菜单命令:", {
							type: "contextmenu",
							coords: coords,
							button: 2, // 右键
							source: "pointer-lock-contextmenu",
						});
						this.sendMouseCommand("contextmenu", coords, {
							button: 2, // 右键
							source: "pointer-lock-contextmenu",
						});
						console.log("[指针锁定] 右键菜单事件:", { coords });
					}
				}
			}
		};

		// 绑定事件
		document.addEventListener(
			"pointerlockchange",
			this.pointerLockChangeHandler,
		);
		document.addEventListener("pointerlockerror", this.pointerLockErrorHandler);

		// 兼容性事件
		document.addEventListener(
			"mozpointerlockchange",
			this.pointerLockChangeHandler,
		);
		document.addEventListener(
			"webkitpointerlockchange",
			this.pointerLockChangeHandler,
		);
		document.addEventListener(
			"mozpointerlockerror",
			this.pointerLockErrorHandler,
		);
		document.addEventListener(
			"webkitpointerlockerror",
			this.pointerLockErrorHandler,
		);

		if (this.dom.remoteCanvas) {
			// 在指针锁定模式下，很多事件需要在document级别监听
			// 因为pointer lock会改变事件的传播行为

			// 鼠标移动事件绑定到canvas
			this.dom.remoteCanvas.addEventListener(
				"mousemove",
				this.pointerLockMouseMoveHandler,
				{ passive: false },
			);

			// 滚轮事件绑定到document，因为在pointer lock模式下canvas可能不会收到wheel事件
			document.addEventListener("wheel", this.pointerLockWheelHandler, {
				passive: false,
			});

			// 鼠标按键事件绑定到document
			document.addEventListener("mousedown", this.pointerLockMouseDownHandler, {
				passive: false,
			});

			document.addEventListener("mouseup", this.pointerLockMouseUpHandler, {
				passive: false,
			});

			document.addEventListener("click", this.pointerLockClickHandler, {
				passive: false,
			});

			document.addEventListener(
				"contextmenu",
				this.pointerLockContextMenuHandler,
				{ passive: false },
			);

			// 键盘事件监听（用于处理ESC键）
			this.dom.remoteCanvas.addEventListener(
				"keydown",
				this.pointerLockKeyDownHandler,
				{ passive: false },
			);
		}
	}

	// 新增：移除指针锁定事件
	unbindPointerLockEvents() {
		if (this.pointerLockChangeHandler) {
			document.removeEventListener(
				"pointerlockchange",
				this.pointerLockChangeHandler,
			);
			document.removeEventListener(
				"mozpointerlockchange",
				this.pointerLockChangeHandler,
			);
			document.removeEventListener(
				"webkitpointerlockchange",
				this.pointerLockChangeHandler,
			);
		}

		if (this.pointerLockErrorHandler) {
			document.removeEventListener(
				"pointerlockerror",
				this.pointerLockErrorHandler,
			);
			document.removeEventListener(
				"mozpointerlockerror",
				this.pointerLockErrorHandler,
			);
			document.removeEventListener(
				"webkitpointerlockerror",
				this.pointerLockErrorHandler,
			);
		}

		if (this.pointerLockMouseMoveHandler && this.dom.remoteCanvas) {
			this.dom.remoteCanvas.removeEventListener(
				"mousemove",
				this.pointerLockMouseMoveHandler,
			);
		}

		if (this.pointerLockKeyDownHandler && this.dom.remoteCanvas) {
			this.dom.remoteCanvas.removeEventListener(
				"keydown",
				this.pointerLockKeyDownHandler,
			);
		}

		// 清理document级别的事件监听器
		if (this.pointerLockWheelHandler) {
			document.removeEventListener("wheel", this.pointerLockWheelHandler);
		}

		if (this.pointerLockMouseDownHandler) {
			document.removeEventListener(
				"mousedown",
				this.pointerLockMouseDownHandler,
			);
		}

		if (this.pointerLockMouseUpHandler) {
			document.removeEventListener("mouseup", this.pointerLockMouseUpHandler);
		}

		if (this.pointerLockClickHandler) {
			document.removeEventListener("click", this.pointerLockClickHandler);
		}

		if (this.pointerLockContextMenuHandler) {
			document.removeEventListener(
				"contextmenu",
				this.pointerLockContextMenuHandler,
			);
		}

		// 清理引用
		this.pointerLockChangeHandler = null;
		this.pointerLockErrorHandler = null;
		this.pointerLockMouseMoveHandler = null;
		this.pointerLockKeyDownHandler = null;
		this.pointerLockWheelHandler = null;
		this.pointerLockMouseDownHandler = null;
		this.pointerLockMouseUpHandler = null;
		this.pointerLockClickHandler = null;
		this.pointerLockContextMenuHandler = null;
	}

	// 新增：处理指针锁定模式下的鼠标移动
	handlePointerLockMouseMove(movementX, movementY) {
		// 累积相对移动量到虚拟鼠标位置
		if (!this.virtualMousePosition) {
			// 初始化虚拟鼠标位置为canvas中心
			const canvasRect = this.dom.remoteCanvas.getBoundingClientRect();
			this.virtualMousePosition = {
				x: canvasRect.width / 2,
				y: canvasRect.height / 2,
			};
		}

		// 更新虚拟鼠标位置
		this.virtualMousePosition.x += movementX;
		this.virtualMousePosition.y += movementY;

		// 限制在canvas边界内
		const canvasRect = this.dom.remoteCanvas.getBoundingClientRect();
		this.virtualMousePosition.x = Math.max(
			0,
			Math.min(canvasRect.width, this.virtualMousePosition.x),
		);
		this.virtualMousePosition.y = Math.max(
			0,
			Math.min(canvasRect.height, this.virtualMousePosition.y),
		);

		// 转换为远程坐标并发送
		const coords = this.calculateCanvasToRemoteCoords(
			this.virtualMousePosition.x,
			this.virtualMousePosition.y,
		);

		if (coords.valid) {
			// 根据拖拽状态发送不同的事件类型
			const eventType = this.isDragging ? "mousedrag" : "mousemove";
			this.sendMouseCommand(eventType, coords, {
				button: this.dragButton,
			});
		}
	}

	// 新增：发送鼠标命令的通用方法
	sendMouseCommand(type, coords, extra = {}) {
		console.log("[发送鼠标命令] 开始处理:", {
			type: type,
			coords: coords,
			extra: extra,
			isDragging: this.isDragging,
		});

		const p2p = this.p2pConnections.values().next().value;
		if (!p2p) {
			console.warn("[发送鼠标命令] 没有可用的P2P连接");
			return;
		}

		const screenInfo = this.getRemoteScreenInfo();
		if (!screenInfo) {
			console.warn("[发送鼠标命令] 没有远程屏幕信息");
			return;
		}

		const command = {
			type: type,
			x: coords.x,
			y: coords.y,
			clientPlatform: window.electronAPI.platform,
			videoResolution: {
				width: this.canvasRenderer ? this.canvasRenderer.videoWidth : 0,
				height: this.canvasRenderer ? this.canvasRenderer.videoHeight : 0,
			},
			screenInfo: screenInfo,
			...extra, // 先展开 extra，确保其中的值不被覆盖
			source: extra.source || "canvas-dom", // 如果没有提供 source，使用默认值
			isDragging: extra.isDragging !== undefined ? extra.isDragging : this.isDragging, // 优先使用 extra 中的值
		};

		console.log("[发送鼠标命令] 构建的命令:", command);

		// 调试信息
		if (this.dom.dragStatus && type.includes("mouse")) {
			this.dom.dragStatus.textContent = this.isDragging
				? `拖拽${this.dragButton}`
				: "无";
		}

		try {
			p2p.sendControlCommand(command);
			console.log("[发送鼠标命令] 命令已发送到P2P连接");
		} catch (error) {
			console.error("[发送鼠标命令] 发送失败:", error);
		}
	}
}

// 启动应用
document.addEventListener("DOMContentLoaded", () => {
	const app = new ScreenShareApp();
});
