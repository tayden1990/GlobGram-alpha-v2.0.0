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
  const [dataSource, setDataSource] = useState<'real' | 'mock' | 'none'>('none');

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

    // --- WebRTC getStats polling with extensive debugging and multiple access paths ---
    let lastStats: any = {};
    let statsAttempts = 0;
    const interval = setInterval(async () => {
      statsAttempts++;
      
      // Try multiple paths to find the peer connection with extensive debugging
      let pc = null;
      let pcPath = 'none';
      
      try {
        // Path 1: Standard LiveKit engine client
        if ((room as any).engine?.client?._pc) {
          pc = (room as any).engine.client._pc;
          pcPath = 'engine.client._pc';
        }
        // Path 2: Alternative client structure
        else if ((room as any).engine?.client?.pc) {
          pc = (room as any).engine.client.pc;
          pcPath = 'engine.client.pc';
        }
        // Path 3: Direct engine pc
        else if ((room as any).engine?.pc) {
          pc = (room as any).engine.pc;
          pcPath = 'engine.pc';
        }
        // Path 4: Legacy engine structure
        else if ((room as any)._engine?.client?._pc) {
          pc = (room as any)._engine.client._pc;
          pcPath = '_engine.client._pc';
        }
        // Path 5: Look in publisher/subscriber engines
        else if ((room as any).engine?.publisher?.pc) {
          pc = (room as any).engine.publisher.pc;
          pcPath = 'engine.publisher.pc';
        }
        else if ((room as any).engine?.subscriber?.pc) {
          pc = (room as any).engine.subscriber.pc;
          pcPath = 'engine.subscriber.pc';
        }
        // Path 6: Check for RTCPeerConnection in participants
        else if ((room as any).localParticipant?.engine?.client?._pc) {
          pc = (room as any).localParticipant.engine.client._pc;
          pcPath = 'localParticipant.engine.client._pc';
        }
        // Path 7: Look deeper in room structure
        else if ((room as any)._signalClient?.engine?.client?._pc) {
          pc = (room as any)._signalClient.engine.client._pc;
          pcPath = '_signalClient.engine.client._pc';
        }
      } catch (e) {
        console.warn("Error accessing peer connection:", e);
      }

      // Enhanced debugging - log room structure on first few attempts
      if (statsAttempts <= 3) {
        console.log(`[LiveCall Debug ${statsAttempts}] Room structure:`, {
          hasEngine: !!(room as any).engine,
          hasEngineClient: !!(room as any).engine?.client,
          engineClientKeys: (room as any).engine?.client ? Object.keys((room as any).engine.client) : [],
          hasPublisher: !!(room as any).engine?.publisher,
          hasSubscriber: !!(room as any).engine?.subscriber,
          pcFound: !!pc,
          pcPath,
          pcType: pc ? pc.constructor.name : 'none',
          roomKeys: Object.keys(room as any).slice(0, 10), // First 10 keys
        });
      }

      let videoBitrate = 0;
      let audioBitrate = 0;
      let fps = 0;
      let foundStats = false;
      let statsDetails: any = {};

      if (pc && typeof pc.getStats === "function") {
        try {
          const stats = await pc.getStats();
          let reportCount = 0;
          let outboundReports: any[] = [];
          
          stats.forEach((report: any) => {
            reportCount++;
            if (report.type === "outbound-rtp") {
              outboundReports.push({
                kind: report.kind,
                bytesSent: report.bytesSent,
                framesPerSecond: report.framesPerSecond,
                id: report.id
              });
            }
            
            if (report.type === "outbound-rtp" && report.kind === "video") {
              foundStats = true;
              setDataSource('real');
              if (lastStats[report.id]) {
                const bytes = report.bytesSent - lastStats[report.id].bytesSent;
                videoBitrate = Math.round((bytes * 8) / 2 / 1000); // kbps, 2s interval
                if (report.framesPerSecond) fps = report.framesPerSecond;
              }
              lastStats[report.id] = { bytesSent: report.bytesSent };
            }
            if (report.type === "outbound-rtp" && report.kind === "audio") {
              foundStats = true;
              if (lastStats[report.id]) {
                const bytes = report.bytesSent - lastStats[report.id].bytesSent;
                audioBitrate = Math.round((bytes * 8) / 2 / 1000); // kbps
              }
              lastStats[report.id] = { bytesSent: report.bytesSent };
            }
          });
          
          statsDetails = { reportCount, outboundReports: outboundReports.slice(0, 3) }; // First 3 reports
        } catch (e) {
          console.warn("getStats failed:", e);
          statsDetails = { error: e instanceof Error ? e.message : String(e) };
        }
      }

      // Fallback: generate mock data if no real stats found after 5 attempts
      if (!foundStats && statsAttempts > 5) {
        setDataSource('mock');
        videoBitrate = Math.floor(Math.random() * 500) + 200; // 200-700 kbps
        audioBitrate = Math.floor(Math.random() * 50) + 20;   // 20-70 kbps
        fps = Math.floor(Math.random() * 10) + 20;           // 20-30 fps
      }

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

      // Enhanced debug logging
      if (statsAttempts <= 8) {
        console.log(`[LiveCall Stats ${statsAttempts}]:`, {
          pcFound: !!pc,
          pcPath,
          foundStats,
          statsDetails,
          results: { videoBitrate, audioBitrate, fps },
          dataSource: foundStats ? 'real' : (statsAttempts > 5 ? 'mock' : 'searching')
        });
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

      <h3>Live Stats (last 30 points) 
        <span style={{ 
          marginLeft: '10px', 
          fontSize: '14px', 
          padding: '2px 8px', 
          borderRadius: '4px',
          background: dataSource === 'real' ? '#0a5d0a' : dataSource === 'mock' ? '#5d4a0a' : '#444',
          color: dataSource === 'real' ? '#90ee90' : dataSource === 'mock' ? '#ffd700' : '#ccc'
        }}>
          {dataSource === 'real' ? '🟢 Real WebRTC Data' : 
           dataSource === 'mock' ? '🟡 Mock Data' : '⚪ No Data'}
        </span>
      </h3>
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
