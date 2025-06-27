// 应用配置
export const config = {
  // P2P连接配置
  p2p: {
    iceGatheringTimeout: 2000, // ICE收集超时时间, ms
  },

  // 信令服务器配置
  signaling: {
    host: '10.10.99.233',
    port: 3002,
    path: '/',
    secure: false, // 使用 ws://
    reconnectInterval: 3000, // 重连间隔, ms
    maxReconnectAttempts: 10, // 最大重连次数
  },

  // WebRTC配置
  webrtc: {
    iceServers: [
      // 局域网环境通常不需要STUN/TURN服务器
      // { urls: 'stun:stun.l.google.com:19302' },
      // { urls: 'stun:stun1.l.google.com:19302' }
    ],
    // 屏幕共享视频约束
    screenVideoConstraints: {
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 30, max: 60 },
    },
    // 数据通道配置
    dataChannel: {
      ordered: true,
      maxRetransmits: 5,
    },
  },
};
