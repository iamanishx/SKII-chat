import EventEmitter from 'events'; // For event-based notifications

class PeerService extends EventEmitter {
  constructor() {
    super();
    this.peer = null;
    this.roomId = null;
    this.socket = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Initial delay for reconnection (ms)
    this.senders = new Map();
    this.isReconnecting = false;
    this.pendingCandidates = []; // Initialize pendingCandidates array

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

  async addIceCandidate(candidate) {
    try {
      if (this.peer?.remoteDescription && this.peer?.remoteDescription.type) {
        await this.peer.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Added ICE candidate successfully');
      } else {
        this.pendingCandidates.push(candidate);
        console.log('Stored ICE candidate for later');
      }
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
      this.emit('error', { 
        type: 'ice-candidate', 
        message: 'Error adding ICE candidate', 
        error 
      });
    }
  }


  async createOffer() {
    if (!this.peer) throw new Error('No peer connection available');
    try {
      const offer = await this.peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: true // Add this to help with connection issues
      });
      await this.peer.setLocalDescription(offer);
      return offer;
    } catch (error) {
      this.emit('error', { type: 'offer', message: 'Error creating offer', error });
      await this.handleConnectionFailure();
    }
  }
  
  async createAnswer(offer) {
    if (!this.peer) throw new Error('No peer connection available');
    try {
      await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);
      return answer;
    } catch (error) {
      this.emit('error', { type: 'answer', message: 'Error creating answer', error });
      await this.handleConnectionFailure();
    }
  }


  async setRemoteDescription(answer) {
    if (!this.peer) return;

    // Prevent concurrent setRemoteDescription calls
    if (this.isSettingRemoteDescription) {
      console.log('Already setting remote description, skipping');
      return;
    }

    try {
      this.isSettingRemoteDescription = true;
      const currentState = this.peer.signalingState;
      console.log('Current signaling state:', currentState);

      // Only proceed if we're in a valid state to set remote description
      if (['stable', 'have-local-offer'].includes(currentState)) {
        if (currentState === 'stable') {
          // If we're stable, we need to set local description first
          const offer = await this.createOffer();
          await this.peer.setLocalDescription(offer);
        }

        await this.peer.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('Remote description set successfully');

        // Process any pending ICE candidates
        while (this.pendingCandidates.length > 0) {
          const candidate = this.pendingCandidates.shift();
          await this.addIceCandidate(candidate);
        }
      } else {
        console.warn(`Invalid signaling state for setting remote description: ${currentState}`);
        throw new Error(`Invalid signaling state: ${currentState}`);
      }
    } catch (error) {
      console.error('Error setting remote description:', error);
      this.emit('error', {
        type: 'remote-description',
        message: 'Connection failed. Please try again.',
        error
      });
      await this.handleConnectionFailure();
    } finally {
      this.isSettingRemoteDescription = false;
    }
  }


  async initializePeer(roomId) {
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
      console.log('STUN connection failed, falling back to TURN');
      await this.initializeWithTurn();
    }
  }

  async initializeWithStun() {
    try {
      const config = {
        iceServers: [
          {
            urls: [
              'stun:stun1.l.google.com:19302',
              'stun:stun2.l.google.com:19302',
              'stun:stun.stunprotocol.org:3478',
              'stun:stun.voiparound.com'
            ]
          }
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      };
      await this.createPeerConnection(config);
      console.log('STUN-based peer connection initialized successfully.');
    } catch (error) {
      console.error('Error initializing STUN connection:', error);
      this.emit('error', {
        type: 'stun',
        message: 'Failed to initialize STUN connection',
        error,
      });
      throw error;
    }
  }
  
  async initializeWithTurn() {
    try {
      const response = await fetch(import.meta.env.VITE_CRED, {
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch TURN credentials: ${response.status} ${response.statusText}\n${errorText}`);
      }
  
      let credentials;
      try {
        credentials = await response.json();
      } catch (e) {
        throw new Error(`Invalid JSON response from TURN server: ${await response.text()}`);
      }
  
      // Validate Cloudflare credentials format
      if (!credentials?.urls?.length || !credentials.username || !credentials.credential) {
        throw new Error('Invalid Cloudflare TURN credentials format');
      }
  
      // Create config with Cloudflare credentials
      const config = {
        iceServers: [
          // Include Cloudflare's combined STUN/TURN configuration
          {
            urls: credentials.urls,
            username: credentials.username,
            credential: credentials.credential
          }
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      };
  
      await this.createPeerConnection(config);
      console.log('TURN-based peer connection initialized successfully with Cloudflare.');
    } catch (error) {
      console.error('Error initializing Cloudflare TURN connection:', error);
      this.emit('error', {
        type: 'turn',
        message: 'Failed to initialize Cloudflare TURN connection',
        error,
      });
      throw error;
    }
  }
  
  async createPeerConnection(config) {
    if (!config?.iceServers?.length) {
      throw new Error('Invalid configuration: iceServers array is required');
    }
  
    // Log the configuration for debugging
    console.log('Creating peer connection with config:', JSON.stringify(config, null, 2));
  
    this.peer = new RTCPeerConnection(config);
    this.setupPeerEvents();
  }

  
  setupPeerEvents() {
    if (!this.peer) return;

    this.peer.onicecandidate = ({ candidate }) => {
      if (candidate && this.roomId) {
        console.log('Sending ICE candidate');
        this.socket?.emit('peer:ice-candidate', {
          candidate,
          to: this.roomId
        });
      }
    };

    this.peer.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      
      // Create a new MediaStream if it doesn't exist
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }

      // Add the track to our remote stream
      this.remoteStream.addTrack(event.track);
      
      // Emit the stream immediately when we get both audio and video
      if (this.remoteStream.getTracks().length >= 2) {
        console.log('Emitting complete remote stream');
        this.emit('remoteStream', {
          stream: this.remoteStream,
          roomId: this.roomId
        });
      }
    };

    this.peer.onconnectionstatechange = () => {
      const state = this.peer?.connectionState;
      console.log('Connection state changed:', state);

      if (state === 'connected') {
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        console.log('Peer connection established successfully');
      } else if (['disconnected', 'failed'].includes(state) && !this.isReconnecting) {
        console.log('Connection state failure:', state);
        this.handleConnectionFailure();
      }
    };

    this.peer.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', this.peer?.iceConnectionState);
      if (this.peer?.iceConnectionState === 'failed') {
        console.log('ICE connection failed - attempting recovery');
        this.handleConnectionFailure();
      }
    };
  }


  async handleConnectionFailure() {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('error', { type: 'reconnect', message: 'Max reconnection attempts reached' });
      this.cleanup();
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    console.log(`Reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);

    setTimeout(async () => {
      try {
        await this.initializeWithTurn();
        if (this.roomId) await this.createOffer();
        this.isReconnecting = false;
      } catch (error) {
        console.error('Reconnection attempt failed:', error);
        this.isReconnecting = false;
        this.handleConnectionFailure();
      }
    }, delay);
  }

  async addTracks(stream) {
    if (!this.peer || !stream) {
      console.error('No peer or stream available');
      return;
    }

    try {
      // Remove existing tracks
      this.senders.forEach(sender => {
        try {
          this.peer.removeTrack(sender);
        } catch (e) {
          console.warn('Error removing track:', e);
        }
      });
      this.senders.clear();

      // Add new tracks
      const tracks = stream.getTracks();
      console.log(`Adding ${tracks} tracks to peer connection`);
      
      tracks.forEach((track) => {
        console.log('Adding track:', track.kind);
        try {
          const sender = this.peer.addTrack(track, stream);
          this.senders.set(track.kind, sender);
        } catch (e) {
          console.error('Error adding track:', e);
        }
      });
    } catch (error) {
      console.error('Error managing tracks:', error);
      this.emit('error', {
        type: 'add-tracks',
        message: 'Error adding tracks',
        error
      });
    }
  }


  async switchMediaSource(newStream) {
    if (!this.peer) {
      console.error('No peer connection available');
      return;
    }

    this.addTracks(newStream);
    this.emit('media-source-switched', { newStream });
  }

  async waitForStableState() {
    if (!this.peer || this.peer.signalingState === 'stable') return;

    return new Promise((resolve) => {
      const checkState = () => {
        if (!this.peer || this.peer.signalingState === 'stable') {
          resolve();
        } else {
          setTimeout(checkState, 100);
        }
      };
      checkState();
    });
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
