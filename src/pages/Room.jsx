import React, { useEffect, useCallback, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { useSocket } from "../context/SocketProvider";
import { Check, Mic, MicOff, Video, VideoOff, Phone, PhoneOff, Copy, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "../assets/ui/alert";
import PeerService from "../service/peer";

const RoomPage = () => {
  const socket = useSocket();
  const { room } = useParams();
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [myStream, setMyStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [roomLink, setRoomLink] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [isCallInProgress, setIsCallInProgress] = useState(false);
  const [error, setError] = useState(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [isStreamReady, setIsStreamReady] = useState(false);




  useEffect(() => {
    if (localVideoRef.current && myStream) {
      const videoElement = localVideoRef.current;

      if (videoElement.srcObject !== myStream) {
        videoElement.srcObject = myStream;

        // Local video doesn't need retry logic because it's muted
        videoElement.play().catch(e => {
          console.error("Error playing local video:", e);
        });
      }
    }
  }, [myStream]);

  useEffect(() => {
  if (remoteVideoRef.current && remoteStream) {
    console.log("Setting remote stream to video element", remoteStream);
    
    // Store this flag to prevent duplicate play attempts
    if (remoteVideoRef.current._isPlayAttemptInProgress) {
      console.log("Play attempt already in progress, skipping");
      return;
    }

    // Check if the stream has video tracks
    const videoTracks = remoteStream.getVideoTracks();
    const audioTracks = remoteStream.getAudioTracks();
    console.log(`Remote stream has ${videoTracks.length} video tracks and ${audioTracks.length} audio tracks`);
    
    // Only proceed if we have video tracks
    if (videoTracks.length === 0) {
      console.warn("Remote stream has no video tracks, waiting...");
      // Don't update srcObject yet
      return;
    }
    
    // Set srcObject
    remoteVideoRef.current.srcObject = remoteStream;
    
    // Define a recursive function to attempt playback with retries
    const attemptPlay = (attempt = 1) => {
      console.log(`Attempting to play remote video (attempt ${attempt})...`);
      
      // Mark that we're attempting to play
      remoteVideoRef.current._isPlayAttemptInProgress = true;
      
      const playPromise = remoteVideoRef.current.play();
      
      if (playPromise !== undefined) {
        playPromise.then(() => {
          console.log("✅ Remote video playing successfully!");
          remoteVideoRef.current._isPlayAttemptInProgress = false;
        }).catch(error => {
          console.error(`❌ Error playing remote video (attempt ${attempt}):`, error);
          
          if (attempt < 5) {
            const delay = Math.min(attempt * 1000, 5000);
            console.log(`Retrying playback in ${delay}ms...`);
            setTimeout(() => attemptPlay(attempt + 1), delay);
          } else {
            console.error("Maximum playback attempts reached");
            remoteVideoRef.current._isPlayAttemptInProgress = false;
          }
        });
      }
    };
    
    // Start playback with a small delay to ensure the stream is ready
    setTimeout(attemptPlay, 1000);
  }
}, [remoteStream]);

  const validateStream = (stream) => {
    if (!stream) {
      console.error("Stream is null or undefined.");
      return false;
    }

    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();

    if (!videoTracks.length && !audioTracks.length) {
      console.error("Stream does not contain any valid tracks.");
      return false;
    }

    if (videoTracks.length && !videoTracks[0].enabled) {
      console.warn("Video track is present but disabled.");
    }

    if (audioTracks.length && !audioTracks[0].enabled) {
      console.warn("Audio track is present but disabled.");
    }

    return true;
  };

  // Initialize room and socket connection
  useEffect(() => {
    if (socket && room) {
      console.log(`Joining room: ${room}`);
      socket.emit("room:join", { room });
      PeerService.setSocket(socket);
      setRoomLink(`${window.location}`);
    }

    // Cleanup function
    return () => {
      cleanupStreams();
    };
  }, [socket, room]);

  const initializeLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });

      if (validateStream(stream)) {
        setMyStream(stream);
        return stream;
      } else {
        throw new Error("Invalid local stream.");
      }
    } catch (error) {
      console.error("Error accessing media devices:", error);
      setError("Failed to access camera and microphone. Please check your permissions.");
      throw error;
    }
  }, []);

  // Enhanced cleanup function
  const cleanupStreams = useCallback(() => {
    if (myStream) {
      myStream.getTracks().forEach((track) => track.stop());
    }
    PeerService.cleanup();
    setMyStream(null);
    setRemoteStream(null);
    setIsCallInProgress(false);
    setError(null);
  }, [myStream]);

  // Handle user joined event
  const handleUserJoined = useCallback(({ id, room: joinedRoom }) => {
    if (joinedRoom === room) {
      console.log(`User joined room ${joinedRoom}, socket ID: ${id}`);
      setRemoteSocketId(id);
    }
  }, [room]);

  // Enhanced call handling with proper error management
  const handleCallUser = useCallback(async () => {
    try {
      setError(null);
      const stream = await initializeLocalStream();
      await PeerService.initializePeer(room);
      await PeerService.addTracks(stream);
      const offer = await PeerService.createOffer();
      if (offer) {
        socket.emit("user:call", { to: remoteSocketId, offer, room });
        setIsCallInProgress(true);
      }
    } catch (error) {
      console.error("Error in handleCallUser:", error);
      setError("Failed to start call. Please refresh and try again.");
      cleanupStreams();
    }
  }, [remoteSocketId, room, socket, initializeLocalStream, cleanupStreams]);

  // Enhanced incoming call handler
  const handleIncomingCall = useCallback(async ({ from, offer }) => {
    try {
      setError(null);
      setRemoteSocketId(from);
      const stream = await initializeLocalStream();
      await PeerService.cleanup();
      await PeerService.initializePeer(room);
      await PeerService.addTracks(stream);
      const answer = await PeerService.createAnswer(offer);
      if (answer) {
        socket.emit("call:accepted", { to: from, answer });
        setIsCallInProgress(true);
      }
    } catch (error) {
      console.error("Error in handleIncomingCall:", error);
      setError("Failed to accept call. Please refresh and try again.");
      cleanupStreams();
    }
  }, [socket, room, initializeLocalStream, cleanupStreams]);

  // Handle call accepted with error handling
  const handleCallAccepted = useCallback(async ({ answer }) => {
    try {
      await PeerService.setRemoteDescription(answer);
    } catch (error) {
      console.error("Error in handleCallAccepted:", error);
      setError("Failed to establish connection. Please try again.");
      cleanupStreams();
    }
  }, [cleanupStreams]);



  // Setup PeerService event listeners
  useEffect(() => {
    const handlePeerError = ({ type, message }) => {
      console.error(`Peer error (${type}):`, message);
      setError(`Connection error: ${message}`);
    };

    const handleRemoteStream = ({ stream }) => {
      console.log("Remote stream received from peer", stream);
      // Log detailed stream info
      if (stream) {
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        console.log("Remote stream details:", {
          id: stream.id,
          videoTracks: videoTracks.length,
          audioTracks: audioTracks.length,
          videoActive: videoTracks.length > 0 ? videoTracks[0].enabled : false,
          audioActive: audioTracks.length > 0 ? audioTracks[0].enabled : false
        });
      }
      setRemoteStream(stream);
      setIsStreamReady(true);
    };

    PeerService.on('error', handlePeerError);
    PeerService.on('remoteStream', handleRemoteStream);

    return () => {
      PeerService.off('error', handlePeerError);
      PeerService.off('remoteStream', handleRemoteStream);
    };
  }, []);

  // Enhanced media controls
  const toggleAudio = useCallback(() => {
    if (myStream) {
      const audioTrack = myStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  }, [myStream]);

  const toggleVideo = useCallback(() => {
    if (myStream) {
      const videoTrack = myStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  }, [myStream]);

  const copyRoomLink = useCallback(() => {
    navigator.clipboard.writeText(roomLink);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [roomLink]);

  // Socket event listeners
  useEffect(() => {
    socket.on("user:joined", handleUserJoined);
    socket.on("incoming:call", handleIncomingCall);
    socket.on("call:accepted", handleCallAccepted);
    socket.on("call:ended", cleanupStreams);

    return () => {
      socket.off("user:joined", handleUserJoined);
      socket.off("incoming:call", handleIncomingCall);
      socket.off("call:accepted", handleCallAccepted);
      socket.off("call:ended", cleanupStreams);
    };
  }, [socket, handleUserJoined, handleIncomingCall, handleCallAccepted, cleanupStreams]);

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-6">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Video Chat Room</h1>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={roomLink}
              readOnly
              className="bg-gray-50 px-4 py-2 rounded-lg text-sm w-64"
            />
            <button
              onClick={copyRoomLink}
              className="bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-600 transition-colors"
            >
              {isCopied ? <Check size={20} /> : <Copy size={20} />}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex justify-center gap-4">
            {myStream && (
              <div className="flex gap-2">
                <button
                  onClick={toggleAudio}
                  className={`p-3 rounded-full ${isAudioEnabled ? "bg-blue-500" : "bg-red-500"} text-white`}
                >
                  {isAudioEnabled ? <Mic size={20} /> : <MicOff size={20} />}
                </button>
                <button
                  onClick={toggleVideo}
                  className={`p-3 rounded-full ${isVideoEnabled ? "bg-blue-500" : "bg-red-500"} text-white`}
                >
                  {isVideoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
                </button>
                <button
                  onClick={cleanupStreams}
                  className="p-3 rounded-full bg-red-500 text-white"
                >
                  <PhoneOff size={20} />
                </button>
              </div>
            )}
            {remoteSocketId && !myStream && (
              <button
                onClick={handleCallUser}
                className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
              >
                <Phone size={20} />
                Start Call
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myStream && (
              <div className="relative">
                <h2 className="text-lg font-semibold mb-2">Your Video</h2>
                <video
                  ref={localVideoRef}
                  className="rounded-lg bg-gray-900 w-full"
                  height="300"
                  autoPlay
                  playsInline
                  muted
                />
              </div>
            )}
            {remoteStream && (
              <div className="relative">
                <h2 className="text-lg font-semibold mb-2">Remote Video</h2>
                <video
                  ref={remoteVideoRef}
                  className="rounded-lg bg-gray-900 w-full"
                  autoPlay
                  playsInline
                  muted={false}
                  style={{
                    border: '3px solid red',
                    minHeight: '240px'
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 text-center text-gray-600">
          {remoteSocketId ?
            <p>Connected with peer</p> :
            <p>Waiting for someone to join...</p>
          }
        </div>
      </div>
    </div>
  );
};

export default RoomPage;