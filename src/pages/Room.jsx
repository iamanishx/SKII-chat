import React, { useEffect, useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { useSocket } from "../context/SocketProvider";
import { Check, Mic, MicOff, Video, VideoOff, Phone, PhoneOff, Copy } from "lucide-react";
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

  // Initialize room and socket connection
  useEffect(() => {
    if (socket && room) {
      console.log(`Joining room: ${room}`);
      socket.emit("room:join", { room });
      PeerService.setSocket(socket);
      setRoomLink(`${window.location}`);
    }
  }, [socket, room]);
  
  // Function to initialize the local media stream
  const initializeLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      });
      setMyStream(stream);
      return stream;
    } catch (error) {
      console.error("Error accessing media devices:", error);
      throw error;
    }
  };

  // Handle user joined event
  const handleUserJoined = useCallback(({ id, room: joinedRoom }) => {
    console.log(`User ${id} joined room ${joinedRoom}`);
    if (joinedRoom === room) { // Only set remote ID if it's the same room
      setRemoteSocketId(id);
    }
  }, [room]);

  // Send local tracks to the peer connection
  const sendStreams = useCallback(() => {
    if (!myStream || !PeerService.peer) return;
    myStream.getTracks().forEach((track) => {
      const senders = PeerService.peer.getSenders();
      const existingSender = senders.find((sender) => sender.track?.kind === track.kind);
      if (existingSender) {
        existingSender.replaceTrack(track);
      } else {
        PeerService.peer.addTrack(track, myStream);
      }
    });
  }, [myStream]);

  // Handle making a call
  const handleCallUser = useCallback(async () => {
    try {
      const stream = await initializeLocalStream();
      await PeerService.initializePeer(room); // Use the actual room ID
      await PeerService.addTracks(stream);
      const offer = await PeerService.createOffer();
      socket.emit("user:call", { to: remoteSocketId, offer, room }); // Include room
      setIsCallInProgress(true);
      console.log(`Initiating call in room ${room} to:`, remoteSocketId);
    } catch (error) {
      console.error("Error in handleCallUser:", error);
      setIsCallInProgress(false);
    }
  }, [remoteSocketId, room, socket]);
  
  // Handle incoming call
  const handleIncomingCall = useCallback(async ({ from, offer }) => {
    try {
      setRemoteSocketId(from);
      const stream = await initializeLocalStream();
      await PeerService.initializePeer(room);
      await PeerService.addTracks(stream);
      const answer = await PeerService.createAnswer(offer);
      socket.emit("call:accepted", { to: from, answer });
      setIsCallInProgress(true);
    } catch (error) {
      console.error("Error in handleIncomingCall:", error);
      setIsCallInProgress(false);
    }
  }, [socket, room]);

  // Handle call accepted
  const handleCallAccepted = useCallback(({ answer }) => {
    try {
      PeerService.setRemoteDescription(answer);
      sendStreams();
    } catch (error) {
      console.error("Error in handleCallAccepted:", error);
    }
  }, [sendStreams]);

  // Handle negotiation needed
  const handleNegotiationNeeded = useCallback(async () => {
    try {
      const offer = await PeerService.createOffer();
      socket.emit("peer:nego:needed", { offer, to: remoteSocketId });
    } catch (error) {
      console.error("Error in handleNegotiationNeeded:", error);
    }
  }, [remoteSocketId, socket]);

  // Handle incoming negotiation
  const handleNegotiationIncoming = useCallback(async ({ from, offer }) => {
    try {
      const answer = await PeerService.getAnswer(offer);
      socket.emit("peer:nego:done", { to: from, answer });
    } catch (error) {
      console.error("Error in handleNegotiationIncoming:", error);
    }
  }, [socket]);

  // Handle final negotiation
  const handleNegotiationFinal = useCallback(async ({ answer }) => {
    try {
      await PeerService.setLocalDescription(answer);
    } catch (error) {
      console.error("Error in handleNegotiationFinal:", error);
    }
  }, []);

  // Handle ending a call
  const handleEndCall = useCallback(() => {
    if (myStream) {
      myStream.getTracks().forEach((track) => track.stop());
    }
    PeerService.cleanup();
    setMyStream(null);
    setRemoteStream(null);
    setIsCallInProgress(false);
    socket.emit("call:end", { to: remoteSocketId });
  }, [myStream, remoteSocketId, socket]);

  // Toggle audio
  const toggleAudio = useCallback(() => {
    if (myStream) {
      const audioTrack = myStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  }, [myStream]);

  // Toggle video
  const toggleVideo = useCallback(() => {
    if (myStream) {
      const videoTrack = myStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  }, [myStream]);

  // Copy room link
  const copyRoomLink = useCallback(() => {
    navigator.clipboard.writeText(roomLink);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [roomLink]);

  // Set up event listeners
  useEffect(() => {
    socket.on("user:joined", handleUserJoined);
    socket.on("incoming:call", handleIncomingCall);
    socket.on("call:accepted", handleCallAccepted);
    socket.on("peer:nego:needed", handleNegotiationIncoming);
    socket.on("peer:nego:final", handleNegotiationFinal);
    socket.on("call:ended", handleEndCall);

    return () => {
      socket.off("user:joined", handleUserJoined);
      socket.off("incoming:call", handleIncomingCall);
      socket.off("call:accepted", handleCallAccepted);
      socket.off("peer:nego:needed", handleNegotiationIncoming);
      socket.off("peer:nego:final", handleNegotiationFinal);
      socket.off("call:ended", handleEndCall);
    };
  }, [
    socket,
    handleUserJoined,
    handleIncomingCall,
    handleCallAccepted,
    handleNegotiationIncoming,
    handleNegotiationFinal,
    handleEndCall,
  ]);

  // Handle remote stream
  useEffect(() => {
    if (!PeerService.peer) return;

    const handleTrack = (event) => {
      const [remoteVideoStream] = event.streams;
      setRemoteStream(remoteVideoStream);
    };

    PeerService.peer.ontrack = handleTrack;

    return () => {
      if (PeerService.peer) {
        PeerService.peer.ontrack = null;
      }
    };
  }, []);

  useEffect(() => {
    setRoomLink(`${window.location}`);
  }, [socket.id]);

  
  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-6">
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
                  onClick={handleEndCall}
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
                  className="rounded-lg bg-gray-900 w-full"
                  height="300"
                  autoPlay
                  muted
                  playsInline
                  ref={(video) => {
                    if (video) video.srcObject = myStream;
                  }}
                />
              </div>
            )}
            {remoteStream && (
              <div className="relative">
                <h2 className="text-lg font-semibold mb-2">Remote Video</h2>
                <video
                  className="rounded-lg bg-gray-900 w-full"
                  height="300"
                  autoPlay
                  playsInline
                  ref={(video) => {
                    if (video) video.srcObject = remoteStream;
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 text-center text-gray-600">
          {remoteSocketId ? <p>Connected with peer</p> : <p>Waiting for someone to join...</p>}
        </div>
      </div>
    </div>
  );
};

export default RoomPage;