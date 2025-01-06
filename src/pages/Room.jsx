import React, { useEffect, useCallback, useState } from "react";
import ReactPlayer from "react-player";
import peer from "../service/peer";
import { useSocket } from "../context/SocketProvider";
import { Check, Mic, MicOff, Video, VideoOff, Phone, PhoneOff, Copy } from "lucide-react";

const RoomPage = () => {
  const socket = useSocket();
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [myStream, setMyStream] = useState();
  const [remoteStream, setRemoteStream] = useState();
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [roomLink, setRoomLink] = useState("");
  const [isCopied, setIsCopied] = useState(false);

  const handleUserJoined = useCallback(({ email, id }) => {
    console.log(`Email ${email} joined room`);
    setRemoteSocketId(id);
  }, []);

  const sendStreams = useCallback(() => {
    if (myStream) {
      for (const track of myStream.getTracks()) {
        const senders = peer.peer.getSenders();
        const existingSender = senders.find(sender => sender.track?.kind === track.kind);
        
        if (existingSender) {
          existingSender.replaceTrack(track);
        } else {
          peer.peer.addTrack(track, myStream);
        }
      }
    }
  }, [myStream]);

  const handleCallUser = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      setMyStream(stream);
      
      const offer = await peer.getOffer();
      socket.emit("user:call", { to: remoteSocketId, offer });
    } catch (error) {
      console.error("Error in handleCallUser:", error);
    }
  }, [remoteSocketId, socket]);

  const handleIncommingCall = useCallback(async ({ from, offer }) => {
    try {
      setRemoteSocketId(from);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      setMyStream(stream);
      
      const ans = await peer.getAnswer(offer);
      socket.emit("call:accepted", { to: from, ans });
      
      // Send streams after accepting call
      sendStreams();
    } catch (error) {
      console.error("Error in handleIncommingCall:", error);
    }
  }, [socket, sendStreams]);

  const handleCallAccepted = useCallback(({ from, ans }) => {
    try {
      peer.setLocalDescription(ans);
      console.log("Call Accepted!");
      sendStreams(); // Send streams after call is accepted
    } catch (error) {
      console.error("Error in handleCallAccepted:", error);
    }
  }, [sendStreams]);

  const handleNegoNeeded = useCallback(async () => {
    try {
      const offer = await peer.getOffer();
      socket.emit("peer:nego:needed", { offer, to: remoteSocketId });
    } catch (error) {
      console.error("Error in handleNegoNeeded:", error);
    }
  }, [remoteSocketId, socket]);

  const handleNegoNeedIncomming = useCallback(async ({ from, offer }) => {
    try {
      const ans = await peer.getAnswer(offer);
      socket.emit("peer:nego:done", { to: from, ans });
    } catch (error) {
      console.error("Error in handleNegoNeedIncomming:", error);
    }
  }, [socket]);

  const handleNegoNeedFinal = useCallback(async ({ ans }) => {
    try {
      await peer.setLocalDescription(ans);
    } catch (error) {
      console.error("Error in handleNegoNeedFinal:", error);
    }
  }, []);

  const handleEndCall = useCallback(() => {
    try {
      if (myStream) {
        myStream.getTracks().forEach(track => track.stop());
      }
      if (peer.peer) {
        peer.peer.getSenders().forEach(sender => {
          peer.peer.removeTrack(sender);
        });
      }
      setMyStream(null);
      setRemoteStream(null);
      peer.cleanup();
      socket.emit("call:end", { to: remoteSocketId });
    } catch (error) {
      console.error("Error in handleEndCall:", error);
    }
  }, [myStream, remoteSocketId, socket]);

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
    const link = `${window.location.origin}/room/${socket.id}`;
    navigator.clipboard.writeText(link);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [socket.id]);

  // Handle remote tracks
  useEffect(() => {
    if (!peer.peer) return;

    peer.peer.ontrack = (event) => {
      const [remoteVideoStream] = event.streams;
      console.log("Got remote track:", event.track.kind);
      setRemoteStream(remoteVideoStream);
    };
  }, []);

  // Handle negotiation
  useEffect(() => {
    if (!peer.peer) return;

    peer.peer.onnegotiationneeded = handleNegoNeeded;
    return () => {
      peer.peer.onnegotiationneeded = null;
    };
  }, [handleNegoNeeded]);

  // Setup socket listeners
  useEffect(() => {
    socket.on("user:joined", handleUserJoined);
    socket.on("incomming:call", handleIncommingCall);
    socket.on("call:accepted", handleCallAccepted);
    socket.on("peer:nego:needed", handleNegoNeedIncomming);
    socket.on("peer:nego:final", handleNegoNeedFinal);
    socket.on("call:end", handleEndCall);

    return () => {
      socket.off("user:joined", handleUserJoined);
      socket.off("incomming:call", handleIncommingCall);
      socket.off("call:accepted", handleCallAccepted);
      socket.off("peer:nego:needed", handleNegoNeedIncomming);
      socket.off("peer:nego:final", handleNegoNeedFinal);
      socket.off("call:end", handleEndCall);
    };
  }, [
    socket,
    handleUserJoined,
    handleIncommingCall,
    handleCallAccepted,
    handleNegoNeedIncomming,
    handleNegoNeedFinal,
    handleEndCall,
  ]);

  // Set room link
  useEffect(() => {
    setRoomLink(`${window.location.origin}/room/${socket.id}`);
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
                  className={`p-3 rounded-full ${
                    isAudioEnabled ? 'bg-blue-500' : 'bg-red-500'
                  } text-white`}
                >
                  {isAudioEnabled ? <Mic size={20} /> : <MicOff size={20} />}
                </button>
                <button
                  onClick={toggleVideo}
                  className={`p-3 rounded-full ${
                    isVideoEnabled ? 'bg-blue-500' : 'bg-red-500'
                  } text-white`}
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
                <div className="rounded-lg overflow-hidden bg-gray-900">
                  <ReactPlayer
                    playing
                    muted
                    height="300px"
                    width="100%"
                    url={myStream}
                  />
                </div>
              </div>
            )}
            {remoteStream && (
              <div className="relative">
                <h2 className="text-lg font-semibold mb-2">Remote Video</h2>
                <div className="rounded-lg overflow-hidden bg-gray-900">
                  <ReactPlayer
                    playing
                    height="300px"
                    width="100%"
                    url={remoteStream}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 text-center text-gray-600">
          {remoteSocketId ? (
            <p>Connected with peer</p>
          ) : (
            <p>Waiting for someone to join...</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default RoomPage;