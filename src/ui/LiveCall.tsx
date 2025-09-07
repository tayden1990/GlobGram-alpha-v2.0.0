import React, { useEffect, useRef, useState } from "react";
import { Room, RemoteParticipant, Track } from "livekit-client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";

interface LiveCallProps {
  room: Room;
}

interface StatPoint {
  time: string;
  videoBitrate: number;
  audioBitrate: number;
  fps: number;
}

const VIDEO_BITRATE_THRESHOLD = 300; // kbps
const FPS_THRESHOLD = 15; // fps

const LiveCall: React.FC<LiveCallProps> = ({ room }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const [statsHistory, setStatsHistory] = useState<StatPoint[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);

  useEffect(() => {
    if (!room) return;

    // Attach local video (camera)
    const localCamPub = Array.from(room.localParticipant.trackPublications.values()).find(
      (pub: any) => pub.source === Track.Source.Camera
    );
    if (localCamPub && localCamPub.track && localVideoRef.current) {
      localCamPub.track.attach(localVideoRef.current);
    }

    // Attach remote video for the first participant (if any)
    const attachRemoteVideo = (participant: RemoteParticipant) => {
      const videoPub = Array.from(participant.trackPublications.values()).find(
        (pub: any) => pub.kind === "video" && pub.track
      );
      if (videoPub && videoPub.track && remoteVideoRef.current) {
        videoPub.track.attach(remoteVideoRef.current);
      }
      participant.on("trackSubscribed", (track: Track) => {
        if (track.kind === "video" && remoteVideoRef.current) {
          track.attach(remoteVideoRef.current);
        }
      });
    };

    // Attach to already connected participants
    const remoteParticipants = Array.from(((room as any).participants?.values?.() ?? [])) as RemoteParticipant[];
    remoteParticipants.forEach((participant) => {
      attachRemoteVideo(participant);
    });
    // Listen for new participants
    room.on("participantConnected", attachRemoteVideo);

    // --- WebRTC getStats polling ---
    let lastStats: any = {};
    const interval = setInterval(async () => {
      // Try to get the underlying RTCPeerConnection from LiveKit
      const pc = (room as any).engine?.client?._pc;
      if (!pc || typeof pc.getStats !== "function") return;
      let videoBitrate = 0;
      let audioBitrate = 0;
      let fps = 0;
      try {
        const stats = await pc.getStats();
        stats.forEach((report: any) => {
          if (report.type === "outbound-rtp" && report.kind === "video") {
            if (lastStats[report.id]) {
              const bytes = report.bytesSent - lastStats[report.id].bytesSent;
              videoBitrate = Math.round((bytes * 8) / 2 / 1000); // kbps, 2s interval
              if (report.framesPerSecond) fps = report.framesPerSecond;
            }
            lastStats[report.id] = { bytesSent: report.bytesSent };
          }
          if (report.type === "outbound-rtp" && report.kind === "audio") {
            if (lastStats[report.id]) {
              const bytes = report.bytesSent - lastStats[report.id].bytesSent;
              audioBitrate = Math.round((bytes * 8) / 2 / 1000); // kbps
            }
            lastStats[report.id] = { bytesSent: report.bytesSent };
          }
        });
      } catch {}
      const time = new Date().toLocaleTimeString();
      const newPoint = { time, videoBitrate, audioBitrate, fps };
      setStatsHistory((prev) => [...prev.slice(-29), newPoint]);

      // Alerts
      const newAlerts: string[] = [];
      if (videoBitrate && videoBitrate < VIDEO_BITRATE_THRESHOLD) {
        newAlerts.push(`⚠️ Low video bitrate: ${videoBitrate} kbps at ${time}`);
      }
      if (fps && fps < FPS_THRESHOLD) {
        newAlerts.push(`⚠️ Low FPS: ${fps} at ${time}`);
      }
      if (newAlerts.length > 0) {
        setAlerts((prev) => [...prev, ...newAlerts].slice(-50));
      }
    }, 2000);

    // Cleanup
    return () => {
      clearInterval(interval);
      room.off("participantConnected", attachRemoteVideo);
    };
  }, [room]);

  // --- Render UI ---
  return (
    <div style={{ padding: "20px" }}>
      <h2>Local Video</h2>
      <video ref={localVideoRef} autoPlay muted playsInline style={{ width: "300px", border: "1px solid gray" }} />

      <h2>Remote Video</h2>
      <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "300px", border: "1px solid gray" }} />

      <h3>Live Stats (last 30 points)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={statsHistory}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="videoBitrate" stroke="#8884d8" name="Video Bitrate (kbps)" />
          <Line type="monotone" dataKey="audioBitrate" stroke="#82ca9d" name="Audio Bitrate (kbps)" />
          <Line type="monotone" dataKey="fps" stroke="#ff7300" name="FPS" />
        </LineChart>
      </ResponsiveContainer>

      <h3>Alerts</h3>
      <div style={{ maxHeight: "150px", overflowY: "auto", border: "1px solid #ccc", padding: "10px", background: "#fffbe6" }}>
        {alerts.map((alert, idx) => (
          <div key={idx}>{alert}</div>
        ))}
      </div>
    </div>
  );
}

export default LiveCall;
