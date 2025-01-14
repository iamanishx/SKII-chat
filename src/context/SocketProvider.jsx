import React, { createContext, useMemo, useContext } from "react";
import { io } from "socket.io-client";
import PeerService from "../service/peer";

const SocketContext = createContext(null);

export const useSocket = () => {
  const socket = useContext(SocketContext);
  return socket;
};

export const SocketProvider = (props) => {
  const socketUrl = import.meta.env.VITE_SOCKET_URL;
  
  const socket = useMemo(() => {
    const s = io(socketUrl);

    // Handle room join event
    s.on("user:joined", ({ id, room, email }) => {
      console.log(`New user joined room ${room} with ID:`, id);
    });

    // Handle incoming call with room context
    s.on("incoming:call", async ({ from, offer, room }) => {
      console.log(`Incoming call in room ${room} from:`, from);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
        
        await PeerService.initializePeer(room);
        await PeerService.addTracks(stream);
        const answer = await PeerService.createAnswer(offer);
        
        s.emit("call:accepted", { to: from, answer, room });
      } catch (error) {
        console.error("Error handling incoming call:", error);
      }
    });

    // Handle call acceptance
    s.on("call:accepted", async ({ answer, room }) => {
      console.log(`Call accepted in room ${room}`);
      try {
        if (!PeerService.peer) {
          await PeerService.initializePeer(room);
        }
        await PeerService.setRemoteDescription(answer);
      } catch (error) {
        console.error("Error setting remote description:", error);
      }
    });
    // Handle negotiation
    s.on("peer:nego:needed", async ({ from, offer, room }) => {
      console.log(`Negotiation needed in room ${room} from:`, from);
      try {
        const answer = await PeerService.getAnswer(offer);
        s.emit("peer:nego:done", { to: from, answer, room });
      } catch (error) {
        console.error("Error during negotiation:", error);
      }
    });

    s.on("peer:nego:final", async ({ answer, room }) => {
      console.log(`Negotiation finalized in room ${room}`);
      try {
        await PeerService.setLocalDescription(answer);
      } catch (error) {
        console.error("Error setting local description:", error);
      }
    });

    // Handle call end
    s.on("call:ended", ({ room }) => {
      console.log(`Call ended in room ${room}`);
      PeerService.cleanup();
    });

    return s;
  }, []);

  PeerService.setSocket(socket);

  return (
    <SocketContext.Provider value={socket}>
      {props.children}
    </SocketContext.Provider>
  );
};