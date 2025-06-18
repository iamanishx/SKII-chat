import EventEmitter from "events";

class PeerService extends EventEmitter {
  constructor() {
    super();
    this.peer = null;
    this.roomId = null;
    this.socket = null;

    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.isReconnecting = false;
    this.isSettingRemoteDescription = false;

    this.senders = new Map();
    this.pendingCandidates = [];

    this._streamTracking = new Map();
    this.remotePeerId = null;
  }

  setSocket(socket) {
    this.socket = socket;
    this.setupSocketEvents();
  }

  setupSocketEvents() {
    if (!this.socket) return;

    this.socket.off("peer:ice-candidate");

    this.socket.on("peer:ice-candidate", ({ candidate, from, room }) => {
      console.log(`📥 Received ICE candidate from ${from} in room ${room}`);
      if (candidate && this.peer && room === this.roomId) {
        this.addIceCandidate(candidate);
      }
    });
  }

  // ICE Candidate Management
  async addIceCandidate(candidate) {
    try {
      if (this.peer?.remoteDescription && this.peer?.remoteDescription.type) {
        await this.peer.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("✅ Added ICE candidate successfully");
      } else {
        this.pendingCandidates.push(candidate);
        console.log("📦 Stored ICE candidate for later");
      }
    } catch (error) {
      console.error("❌ Error adding ICE candidate:", error);
      this.emit("error", {
        type: "ice-candidate",
        message: "Error adding ICE candidate",
        error,
      });
    }
  }

  // Offer/Answer Management
  async createOffer() {
    if (!this.peer) {
      throw new Error("No peer connection available");
    }

    try {
      console.log("📤 Creating offer...");
      const offer = await this.peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: true,
      });

      await this.peer.setLocalDescription(offer);
      console.log("✅ Offer created and local description set");
      return offer;
    } catch (error) {
      console.error("❌ Error creating offer:", error);
      this.emit("error", {
        type: "offer",
        message: "Error creating offer",
        error,
      });
      await this.handleConnectionFailure();
      throw error;
    }
  }

  async createAnswer(offer) {
    if (!this.peer) {
      throw new Error("No peer connection available");
    }
    try {
      console.log("📥 Creating answer for received offer...");
      await this.peer.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);

      console.log("✅ Answer created and descriptions set");
      return answer;
    } catch (error) {
      console.error("❌ Error creating answer:", error);
      this.emit("error", {
        type: "answer",
        message: "Error creating answer",
        error,
      });
      await this.handleConnectionFailure();
      throw error;
    }
  }

  async setRemoteDescription(answer) {
    if (!this.peer) {
      console.warn("No peer connection available for setRemoteDescription");
      return;
    }
    if (this.isSettingRemoteDescription) {
      console.log("⏳ Already setting remote description, skipping");
      return;
    }
    try {
      this.isSettingRemoteDescription = true;
      const currentState = this.peer.signalingState;
      console.log(
        "🔄 Setting remote description, current state:",
        currentState
      );
      if (["stable", "have-local-offer"].includes(currentState)) {
        await this.peer.setRemoteDescription(new RTCSessionDescription(answer));
        console.log("✅ Remote description set successfully");

        await this.processPendingCandidates();
      } else {
        const errorMsg = `Invalid signaling state for remote description: ${currentState}`;
        console.warn("⚠️", errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error("❌ Error setting remote description:", error);
      this.emit("error", {
        type: "remote-description",
        message: "Connection failed. Please try again.",
        error,
      });
      await this.handleConnectionFailure();
    } finally {
      this.isSettingRemoteDescription = false;
    }
  }

  async processPendingCandidates() {
    if (this.pendingCandidates.length === 0) return;

    console.log(
      `🔄 Processing ${this.pendingCandidates.length} pending ICE candidates`
    );

    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      await this.addIceCandidate(candidate);
    }
  }


  async initializePeer(roomId) {
    console.log("🚀 Initializing peer connection for room:", roomId);

    this.cleanup();

    this.roomId = roomId;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;

    await this.initializeConnection();
  }

  async initializeConnection() {
    try {
      await this.initializeWithStun();
    } catch (error) {
      console.log("🔄 STUN+TURN connection failed, trying cloudflare turn fallback", error);
      try {
      await this.initializeWithTurn();
      } catch (stunError) {
        console.error("❌ Both cloudflare TURN and TURN+STUN initialization failed");
        throw stunError;
      }
    }
  }

  async initializeWithStun() {
    try {
      const config = {
        iceServers: [
          {
            urls: [
              "stun:stun1.l.google.com:19302",
              "stun:stun2.l.google.com:19302",
              "stun:stun3.l.google.com:19302",
              "stun:stun4.l.google.com:19302",
              "stun:stun.cloudflare.com:3478",
            ],
          },
          {
            urls: ["turn:openrelay.metered.ca:80"],
            username: "openrelayproject",
            credential: "openrelayproject",
          },
          {
            urls: ["turn:openrelay.metered.ca:443"],
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
      };

      await this.createPeerConnection(config);
      console.log("✅ Peer connection with STUN+TURN initialized successfully");
    } catch (error) {
      console.error("❌ Error initializing STUN+TURN connection:", error);
      throw error;
    }
  }

  async initializeWithTurn() {
    try {
      console.log("🔄 Fetching TURN credentials...");

      const response = await fetch(import.meta.env.VITE_CRED, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch TURN credentials: ${response.status} ${response.statusText}`
        );
      }

      const credentials = await response.json();
      console.log("🔑 TURN credentials fetched successfully:", credentials);
      if (
        !credentials?.urls?.length ||
        !credentials.username ||
        !credentials.credential
      ) {
        throw new Error("Invalid TURN credentials format");
      }

      const config = {
        iceServers: [
          {
            urls: credentials.urls,
            username: credentials.username,
            credential: credentials.credential,
          },
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
      };

      await this.createPeerConnection(config);
      console.log("✅ TURN-based peer connection initialized successfully");
    } catch (error) {
      console.error("❌ Error initializing TURN connection:", error);
      this.emit("error", {
        type: "turn",
        message: "Failed to initialize TURN connection",
        error,
      });
      throw error;
    }
  }

  async createPeerConnection(config) {
    if (!config?.iceServers?.length) {
      throw new Error("Invalid configuration: iceServers array is required");
    }

    console.log("🔧 Creating peer connection with config:", {
      iceServers: config.iceServers.map((server) => ({
        urls: server.urls,
        hasCredentials: !!(server.username && server.credential),
      })),
      ...config,
    });

    this.peer = new RTCPeerConnection(config);
    this.setupPeerEvents();
  }
  setRemotePeer(peerId) {
    this.remotePeerId = peerId;
    console.log("🎯 Set remote peer ID:", peerId);
  }

  // Event Setup
  setupPeerEvents() {
    if (!this.peer) return;

    // ICE candidate handling
    this.peer.onicecandidate = ({ candidate }) => {
      if (candidate && this.socket) {
        console.log("📤 Sending ICE candidate to room:", this.roomId);
        if (this.remotePeerId) {
          this.socket.emit("peer:ice-candidate", {
            candidate,
            to: this.remotePeerId, 
            room: this.roomId,
          });
        }
      }
    };

    this.peer.ontrack = (event) => {
      this.handleIncomingTrack(event);
    };

    // Connection state monitoring
    this.peer.oniceconnectionstatechange = () => {
    const iceState = this.peer?.iceConnectionState;
    console.log("🔵 ICE connection state:", iceState);

    switch (iceState) {
      case "connected":
      case "completed":
        console.log("✅ ICE CONNECTED - Media should flow now");
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.emit("iceConnected");
        break;
      case "checking":
        console.log("🔄 ICE checking candidates...");
        if (this.iceTimeout) clearTimeout(this.iceTimeout);
        this.iceTimeout = setTimeout(() => {
          if (this.peer?.iceConnectionState === "checking") {
            console.log("⏰ ICE checking timeout - trying fallback");
            this.handleConnectionFailure();
          }
        }, 10000);
        break;
      case "failed":
        console.log("❌ ICE connection failed");
        if (this.iceTimeout) clearTimeout(this.iceTimeout);
        this.handleConnectionFailure();
        break;
      case "disconnected":
        console.log("⚠️ ICE connection disconnected");
        if (this.iceTimeout) clearTimeout(this.iceTimeout);
        setTimeout(() => {
          if (this.peer?.iceConnectionState === "disconnected") {
            this.handleConnectionFailure();
          }
        }, 3000);
        break;
      default:
        console.log("🔵 ICE state:", iceState);
    }
  };

    this.peer.onconnectionstatechange = () => {
      const state = this.peer?.connectionState;
      console.log("🟡 Overall connection state:", state);

      if (state === "connected") {
        console.log("✅ Peer connection fully established");
      } else if (["failed", "disconnected"].includes(state)) {
        console.log("❌ Peer connection failed/disconnected");
        this.handleConnectionFailure();
      }
    };

    // Signaling state changes
    this.peer.onsignalingstatechange = () => {
      console.log("📡 Signaling state:", this.peer?.signalingState);
    };
  }

  // Track Handling
  handleIncomingTrack(event) {
    const stream = event.streams[0];
    if (!stream) {
      console.warn("⚠️ Received track without stream");
      return;
    }

    const streamId = stream.id;
    const trackKind = event.track.kind;

    console.log(`📺 Received ${trackKind} track for stream ${streamId}`);

    // Get or create tracking info
    let trackingInfo = this._streamTracking.get(streamId);
    if (!trackingInfo) {
      trackingInfo = {
        hasAudio: false,
        hasVideo: false,
        emitted: false,
        timeoutId: null,
        stream: stream,
      };
      this._streamTracking.set(streamId, trackingInfo);
    }

    // Update tracking
    if (trackKind === "audio") {
      trackingInfo.hasAudio = true;
    } else if (trackKind === "video") {
      trackingInfo.hasVideo = true;
    }

    // Clear existing timeout
    if (trackingInfo.timeoutId) {
      clearTimeout(trackingInfo.timeoutId);
    }

    // Emit stream when we have both tracks or after timeout
    trackingInfo.timeoutId = setTimeout(() => {
      if (!trackingInfo.emitted) {
        console.log(
          `✅ Emitting remote stream ${streamId} (audio: ${trackingInfo.hasAudio}, video: ${trackingInfo.hasVideo})`
        );
        trackingInfo.emitted = true;
        this.emit("remoteStream", { stream: trackingInfo.stream });
      }
    }, 1000); // Wait 1 second for both tracks
  }

  // Track Management
  async addTracks(stream) {
    if (!this.peer || !stream) {
      console.error("❌ No peer connection or stream available");
      return;
    }

    try {
      console.log("🎵 Adding tracks to peer connection");

      // Remove existing senders
      for (const sender of this.senders.values()) {
        try {
          this.peer.removeTrack(sender);
        } catch (e) {
          console.warn("⚠️ Error removing existing track:", e.message);
        }
      }
      this.senders.clear();

      // Add new tracks
      const tracks = stream.getTracks();
      console.log(`📎 Adding ${tracks.length} tracks to peer connection`);

      tracks.forEach((track) => {
        console.log(`➕ Adding ${track.kind} track`);
        try {
          const sender = this.peer.addTrack(track, stream);
          this.senders.set(track.kind, sender);
        } catch (e) {
          console.error(`❌ Error adding ${track.kind} track:`, e);
        }
      });

      console.log("✅ All tracks added successfully");
    } catch (error) {
      console.error("❌ Error managing tracks:", error);
      this.emit("error", {
        type: "add-tracks",
        message: "Error adding tracks",
        error,
      });
    }
  }

  // Connection Recovery
  async handleConnectionFailure() {
  if (this.isReconnecting) {
    console.log("🔄 Already attempting reconnection");
    return;
  }
  if (this.reconnectAttempts === 0 && this.lastUsedConfig !== 'turn') {
    console.log("🔄 First failure - trying Cloudflare TURN servers");
    this.isReconnecting = true;
    this.reconnectAttempts++;
    
    try {
      const currentRemotePeer = this.remotePeerId;
      const currentRoom = this.roomId;
      await this.cleanup();
      await this.initializeWithTurn();
      this.lastUsedConfig = 'turn';
      this.remotePeerId = currentRemotePeer;
      this.roomId = currentRoom;
      if (this.remotePeerId && this.roomId) {
        console.log("🔄 Re-establishing call with TURN servers");
        this.emit("reconnectCall");
      }
      
      console.log("✅cloudflare TURN fallback successful");
      this.isReconnecting = false;
      return;
    } catch (error) {
      console.error("❌ TURN fallback failed:", error);
      this.isReconnecting = false;
    }
  }
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    console.error("❌ Max reconnection attempts reached");
    this.emit("error", {
      type: "reconnect",
      message: "Connection failed. Please refresh and try again.",
    });
    return;
  }

  this.isReconnecting = true;
  this.reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);
  
  console.log(`🔄 Reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
  
  setTimeout(async () => {
    try {
      await this.cleanup();
      if (this.reconnectAttempts % 2 === 0) {
        await this.initializeWithTurn();
        this.lastUsedConfig = 'turn';
      } else {
        await this.initializeWithStun();
        this.lastUsedConfig = 'stun';
      }
      
      if (this.remotePeerId && this.roomId) {
        this.emit("reconnectCall");
      }
      
      this.isReconnecting = false;
    } catch (error) {
      console.error("❌ Reconnection failed:", error);
      this.isReconnecting = false;
      setTimeout(() => this.handleConnectionFailure(), 1000);
    }
  }, delay);
}

  // Utility Methods
  async switchMediaSource(newStream) {
    if (!this.peer) {
      console.error("❌ No peer connection available for media switch");
      return;
    }

    console.log("🔄 Switching media source");
    await this.addTracks(newStream);
    this.emit("media-source-switched", { newStream });
  }

  async waitForStableState(timeout = 5000) {
    if (!this.peer || this.peer.signalingState === "stable") {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Timeout waiting for stable signaling state"));
      }, timeout);

      const checkState = () => {
        if (!this.peer || this.peer.signalingState === "stable") {
          clearTimeout(timeoutId);
          resolve();
        } else {
          setTimeout(checkState, 100);
        }
      };

      checkState();
    });
  }

  // Cleanup
  cleanup() {
    console.log("🧹 Cleaning up peer connection");
    for (const trackingInfo of this._streamTracking.values()) {
      if (trackingInfo.timeoutId) {
        clearTimeout(trackingInfo.timeoutId);
      }
    }
    this._streamTracking.clear();

    if (this.peer) {
      this.peer.ontrack = null;
      this.peer.onicecandidate = null;
      this.peer.oniceconnectionstatechange = null;
      this.peer.onconnectionstatechange = null;
      this.peer.onsignalingstatechange = null;
      this.remotePeerId = null;

      this.peer.close();
      this.peer = null;
    }

    this.senders.clear();
    this.pendingCandidates.length = 0;
    this.roomId = null;
    this.isReconnecting = false;
    this.isSettingRemoteDescription = false;
    this.reconnectAttempts = 0;
  }
  get connectionState() {
    return this.peer?.connectionState || "closed";
  }

  get iceConnectionState() {
    return this.peer?.iceConnectionState || "closed";
  }

  get signalingState() {
    return this.peer?.signalingState || "closed";
  }
}

export default new PeerService();
