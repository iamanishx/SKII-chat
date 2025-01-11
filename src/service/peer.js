class PeerService {
  constructor() {
    this.peer = null;
    this.roomId = null;
    this.socket = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.senders = new Map();
  }

  setSocket(socket) {
    this.socket = socket;
    this.setupSocketEvents();
  }

  setupSocketEvents() {
    if (!this.socket) return;

    this.socket.off('peer:ice-candidate').on('peer:ice-candidate', ({ candidate }) => {
      if (candidate && this.peer) this.addIceCandidate(candidate);
    });
  }

  sendToPeer(message) {
    if (!this.socket || !this.roomId) return console.error('Socket or roomId not available');
    try {
      console.log("Sending message:", message.type, "to room:", this.roomId);
      this.socket.emit(`peer:${message.type}`, { to: this.roomId, ...message });
    } catch (error) {
      console.error('Error sending message to peer:', error);
    }
  }

  async addIceCandidate(candidate) {
    if (this.peer) {
      try {
        await this.peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }

  async createOffer() {
    if (!this.peer) throw new Error('No peer connection available');
    try {
      const offer = await this.peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await this.peer.setLocalDescription(offer);
      return this.peer.localDescription;
    } catch (error) {
      console.error('Error creating offer:', error);
      await this.handleConnectionFailure();
    }
  }

  async createAnswer(offer) {
    if (!this.peer) throw new Error('No peer connection available');
    try {
      await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(new RTCSessionDescription(answer));
      return this.peer.localDescription;
    } catch (error) {
      console.error('Error creating answer:', error);
      await this.handleConnectionFailure();
    }
  }

  async setRemoteDescription(answer) {
    try {
      await this.peer.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error('Error setting remote description:', error);
      await this.handleConnectionFailure();
    }
  }

  async initializePeer(roomId) {
    this.cleanup();
    this.roomId = roomId;
    this.reconnectAttempts = 0;
    await this.initializeConnection();
  }

  async initializeConnection() {
    try {
      await this.initializeWithStun();
    } catch (error) {
      console.log('STUN connection failed, falling back to TURN');
      await this.initializeWithTurn();
    }
  }

  async initializeWithStun() {
    const iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    await this.createPeerConnection(iceServers);
  }

  async initializeWithTurn() {
    try {
      const response = await fetch(import.meta.env.VITE_CLOUDFLARE_TURN_URL);
      const credentials = await response.json();
      const iceServers = [{ urls: credentials.urls, username: credentials.username, credential: credentials.credential }];
      await this.createPeerConnection(iceServers);
    } catch (error) {
      console.error('Failed to initialize TURN connection:', error);
      throw error;
    }
  }

  async createPeerConnection(iceServers) {
    this.peer = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 10 });
    this.setupPeerEvents();
  }

  setupPeerEvents() {
    if (!this.peer) return;

    this.peer.onicecandidate = ({ candidate }) => {
      if (candidate && this.roomId) this.sendToPeer({ type: 'candidate', candidate });
    };

    this.peer.ontrack = (event) => {
      const remoteStream = event.streams[0];
      window.dispatchEvent(new CustomEvent('remoteStream', { detail: { stream: remoteStream, roomId: this.roomId } }));
    };

    this.peer.onconnectionstatechange = () => {
      console.log('Connection state changed:', this.peer.connectionState);
      if (this.peer.connectionState === 'disconnected' || this.peer.connectionState === 'failed') {
        this.handleConnectionFailure();
      }
    };
  }

  async handleConnectionFailure() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.cleanup();
      return;
    }

    if (this.peer?.iceConnectionState === 'failed') {
      console.log('Connection failed, attempting reconnect');
      this.reconnectAttempts++;
      try {
        await this.initializeWithTurn();
        if (this.roomId) await this.createOffer();
      } catch (error) {
        console.error('Reconnection attempt failed:', error);
      }
    }
  }

  async addTracks(stream) {
    if (!this.peer || !stream) return;

    try {
      this.senders.forEach(sender => this.peer.removeTrack(sender));
      this.senders.clear();

      stream.getTracks().forEach((track) => {
        const sender = this.peer.addTrack(track, stream);
        this.senders.set(track.kind, sender);
      });
    } catch (error) {
      console.error('Error adding tracks:', error);
    }
  }

  cleanup() {
    if (this.peer) {
      this.peer.ontrack = null;
      this.peer.onicecandidate = null;
      this.peer.onconnectionstatechange = null;
      this.peer.close();
      this.peer = null;
    }
    this.senders.clear();
    this.roomId = null;
  }
}

export default new PeerService();
