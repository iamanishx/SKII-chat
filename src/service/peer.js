class PeerService {
  constructor() {
    this.peer = null;
    this.senders = new Map();
    this.initializePeer();
  }

  async initializePeer() {
    try {
      // Get TURN credentials from backend
      const cred = import.meta.env.VITE_CRED;
      const credentials = await fetch(`${cred}`).then((res) => 
        res.json()
      );

      // Configure ICE servers with both STUN and TURN
      const iceServers = [
        {
          urls: [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302",
            "stun:stun3.l.google.com:19302",
            "stun:stun4.l.google.com:19302",
            "stun:stun.cloudflare.com:3478"
          ],
        },
        {
          urls: [
            "turn:turn.cloudflare.com:3478?transport=udp",
            "turn:turn.cloudflare.com:3478?transport=tcp",
            "turns:turn.cloudflare.com:5349?transport=tcp",
          ],
          username: credentials.username,
          credential: credentials.credential,
        },
      ];

      this.peer = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 10,
      });

      this.peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("New ICE candidate:", event.candidate);
        }
      };

      this.peer.onconnectionstatechange = () => {
        console.log("Connection state changed:", this.peer.connectionState);
        if (this.peer.connectionState === 'failed') {
          this.initializePeer(); // Reinitialize on failure
        }
      };

      this.peer.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", this.peer.iceConnectionState);
      };

      this.peer.onnegotiationneeded = () => {
        console.log("Negotiation needed");
      };

      this.peer.ontrack = (event) => {
        console.log("Track received:", event.track.kind);
      };
    } catch (error) {
      console.error("Error initializing peer:", error);
      throw error;
    }
  }

  async addTracks(stream) {
    if (!this.peer) return;
    
    // Remove old tracks
    this.senders.forEach((sender) => {
      this.peer.removeTrack(sender);
    });
    this.senders.clear();

    // Add new tracks
    stream.getTracks().forEach((track) => {
      const sender = this.peer.addTrack(track, stream);
      this.senders.set(track.kind, sender);
    });
  }

  async getOffer() {
    if (!this.peer) return null;
    
    try {
      const offer = await this.peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: true
      });
      
      await this.peer.setLocalDescription(new RTCSessionDescription(offer));
      
      // Wait for ICE gathering to complete
      if (this.peer.iceGatheringState !== 'complete') {
        await new Promise((resolve) => {
          const checkState = () => {
            if (this.peer.iceGatheringState === 'complete') {
              resolve();
            } else {
              setTimeout(checkState, 100);
            }
          };
          checkState();
        });
      }
      
      return this.peer.localDescription;
    } catch (error) {
      console.error("Error creating offer:", error);
      throw error;
    }
  }

  async getAnswer(offer) {
    if (!this.peer) return null;
    
    try {
      await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(new RTCSessionDescription(answer));
      
      // Wait for ICE gathering to complete
      if (this.peer.iceGatheringState !== 'complete') {
        await new Promise((resolve) => {
          const checkState = () => {
            if (this.peer.iceGatheringState === 'complete') {
              resolve();
            } else {
              setTimeout(checkState, 100);
            }
          };
          checkState();
        });
      }
      
      return this.peer.localDescription;
    } catch (error) {
      console.error("Error creating answer:", error);
      throw error;
    }
  }

  async setLocalDescription(ans) {
    if (!this.peer) return;
    
    try {
      await this.peer.setRemoteDescription(new RTCSessionDescription(ans));
    } catch (error) {
      console.error("Error setting remote description:", error);
      throw error;
    }
  }

  async addIceCandidate(candidate) {
    if (!this.peer) return;
    
    try {
      await this.peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Error adding ICE candidate:", error);
    }
  }

  cleanup() {
    if (this.peer) {
      this.peer.close();
      this.peer = null;
    }
    this.senders.clear();
  }
}

export default new PeerService();