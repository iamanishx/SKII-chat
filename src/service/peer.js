class PeerService {
  constructor() {
    this.initializePeer();
  }

  initializePeer() {
    // Create new RTCPeerConnection with STUN servers
    this.peer = new RTCPeerConnection({
      iceServers: [
        {
          urls: [
            "stun:stun.l.google.com:19302",
            "stun:global.stun.twilio.com:3478",
          ],
        },
      ],
    });

    // Handle ICE candidates
    this.peer.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("New ICE candidate:", event.candidate);
      }
    };

    // Log connection state changes
    this.peer.onconnectionstatechange = () => {
      console.log("Connection state:", this.peer.connectionState);
    };

    // Log signaling state changes
    this.peer.onsignalingstatechange = () => {
      console.log("Signaling state:", this.peer.signalingState);
    };

    // Handle ICE connection state changes
    this.peer.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", this.peer.iceConnectionState);
    };
  }

  async getAnswer(offer) {
    if (this.peer) {
      try {
        await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
        const ans = await this.peer.createAnswer();
        await this.peer.setLocalDescription(new RTCSessionDescription(ans));
        return ans;
      } catch (error) {
        console.error("Error creating answer:", error);
        throw error;
      }
    }
  }

  async setLocalDescription(ans) {
    if (this.peer) {
      try {
        await this.peer.setRemoteDescription(new RTCSessionDescription(ans));
      } catch (error) {
        console.error("Error setting remote description:", error);
        throw error;
      }
    }
  }

  async getOffer() {
    if (this.peer) {
      try {
        const offer = await this.peer.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await this.peer.setLocalDescription(new RTCSessionDescription(offer));
        return offer;
      } catch (error) {
        console.error("Error creating offer:", error);
        throw error;
      }
    }
  }

  // Method to clean up peer connection
  cleanup() {
    if (this.peer) {
      this.peer.close();
      this.peer = null;
    }
  }
}

export default new PeerService();