// p2p-connection.js - 屏幕共享和远程控制版本
import { config } from './config.js';
import {
  decodeControlCommand,
  encodeControlCommand,
  isBinaryControlCommand,
} from './control-protocol.js';

/**
 * P2PConnection 类封装了 WebRTC 的连接逻辑，用于屏幕共享和远程控制。
 * 它继承自 EventTarget，可以方便地分发事件。
 */
export class P2PConnection extends EventTarget {
  /**
   * @param {string} localId 本地用户ID
   * @param {string} remoteId 远程用户ID
   * @param {object} options 连接选项，例如 { isGuest: true }
   */
  constructor(localId, remoteId, options = {}) {
    super();
    this.localId = localId;
    this.remoteId = remoteId;
    this.options = options; // 保存选项
    this.pc = null;
    this.dataChannel = null;
    this.remoteStream = null;
    this.isConnected = false;
    this.isControlEnabled = false;
    this._pendingCandidates = [];
  }

  /**
   * 初始化并创建 offer（连接发起方调用）
   * @param {MediaStream} stream 要分享的媒体流（屏幕和音频）
   */
  async createOffer(stream) {
    this._initializePeerConnection();

    // 将媒体流的轨道添加到 PeerConnection
    stream.getTracks().forEach((track) => {
      this.pc.addTrack(track, stream);
    });

    // 创建用于远程控制的数据通道
    this.dataChannel = this.pc.createDataChannel(
      'remote-control',
      config.webrtc.dataChannel,
    );
    this._setupDataChannelEvents();

    // 创建 SDP offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // 等待 ICE 候选收集完成
    await this._waitForIceGathering();
    return this.pc.localDescription;
  }

  /**
   * 处理接收到的 offer 并创建 answer（连接接收方调用）
   * @param {RTCSessionDescriptionInit} offer 远程用户发送的 offer
   * @param {MediaStream} stream 要添加到连接中的本地媒体流
   */
  async createAnswer(offer, stream) {
    this._initializePeerConnection();

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));

    // 在创建 answer 前，将媒体流的轨道添加到 PeerConnection
    if (stream) {
      stream.getTracks().forEach((track) => {
        this.pc.addTrack(track, stream);
      });
    }

    // 创建 SDP answer
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    // 添加缓存的ICE候选
    this._processPendingCandidates();

    // 等待 ICE 候选收集完成
    await this._waitForIceGathering();
    return this.pc.localDescription;
  }

  /**
   * 接收 answer（连接发起方调用）
   * @param {RTCSessionDescriptionInit} answer 远程用户发送的 answer
   */
  async acceptAnswer(answer) {
    if (!this.pc.currentRemoteDescription) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      this._processPendingCandidates();
    }
  }

  /**
   * 添加 ICE 候选
   * @param {RTCIceCandidateInit} candidate
   */
  async addIceCandidate(candidate) {
    try {
      if (this.pc && this.pc.remoteDescription) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        this._pendingCandidates.push(candidate);
      }
    } catch (error) {
      console.error('添加ICE候选失败:', error);
    }
  }

  /**
   * 发送远程控制指令（优先使用二进制协议）
   * @param {object} command 控制指令对象
   */
  sendControlCommand(command) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        // 优先使用二进制协议
        const binaryData = encodeControlCommand(command);
        this.dataChannel.send(binaryData);
      } catch (error) {
        // 如果二进制编码失败，回退到JSON格式
        console.warn('[控制协议] 二进制编码失败，回退到JSON格式:', error);
        try {
          this.dataChannel.send(JSON.stringify(command));
        } catch (jsonError) {
          console.error('[控制协议] JSON编码也失败:', jsonError);
        }
      }
    } else {
      console.warn('数据通道未打开，无法发送控制指令');
    }
  }

  /**
   * 关闭P2P连接
   */
  close() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.isConnected = false;
    this.isControlEnabled = false;
    this.dispatchEvent(new CustomEvent('close'));
    console.log(`与 ${this.remoteId} 的连接已关闭`);
  }

  /**
   * 初始化 RTCPeerConnection 并设置事件监听
   * @private
   */
  _initializePeerConnection() {
    this.pc = new RTCPeerConnection({ iceServers: config.webrtc.iceServers });

    // 如果是观看端，则设置收发器以准备接收媒体
    if (this.options.isGuest) {
      this.pc.addTransceiver('video', { direction: 'recvonly' });
      this.pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.dispatchEvent(
          new CustomEvent('icecandidate', { detail: event.candidate }),
        );
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      console.log(`与 ${this.remoteId} 的连接状态变为: ${state}`);
      if (state === 'connected') {
        this.isConnected = true;
        this.dispatchEvent(new CustomEvent('connect'));
      } else if (['disconnected', 'failed', 'closed'].includes(state)) {
        this.close();
      }
    };

    this.pc.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      this.dispatchEvent(
        new CustomEvent('stream', { detail: this.remoteStream }),
      );
    };

    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this._setupDataChannelEvents();
    };
  }

  /**
   * 设置数据通道的事件监听
   * @private
   */
  _setupDataChannelEvents() {
    this.dataChannel.onopen = () => {
      this.isControlEnabled = true;
      console.log(`与 ${this.remoteId} 的数据通道已打开`);
      this.dispatchEvent(new CustomEvent('controlopen'));
    };

    this.dataChannel.onclose = () => {
      this.isControlEnabled = false;
      console.log(`与 ${this.remoteId} 的数据通道已关闭`);
      this.dispatchEvent(new CustomEvent('controlclose'));
    };

    this.dataChannel.onmessage = (event) => {
      try {
        let command;

        // 检测是否为二进制协议格式
        if (isBinaryControlCommand(event.data)) {
          // 解码二进制格式
          const buffer =
            event.data instanceof ArrayBuffer
              ? new Uint8Array(event.data)
              : event.data;
          command = decodeControlCommand(buffer);
        } else {
          // 解析JSON格式（向后兼容）
          command = JSON.parse(event.data);
        }

        this.dispatchEvent(new CustomEvent('control', { detail: command }));
      } catch (error) {
        console.error('[控制协议] 解析控制指令失败:', error);
      }
    };
  }

  /**
   * 处理缓存的ICE候选
   * @private
   */
  _processPendingCandidates() {
    this._pendingCandidates.forEach((candidate) =>
      this.addIceCandidate(candidate),
    );
    this._pendingCandidates = [];
  }

  /**
   * 等待ICE收集完成
   * @private
   */
  _waitForIceGathering() {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === 'complete') {
        resolve();
      } else {
        const timeout = setTimeout(() => {
          console.warn('ICE 收集超时');
          resolve();
        }, config.p2p.iceGatheringTimeout);

        this.pc.addEventListener('icegatheringstatechange', () => {
          if (this.pc.iceGatheringState === 'complete') {
            clearTimeout(timeout);
            resolve();
          }
        });
      }
    });
  }
}
