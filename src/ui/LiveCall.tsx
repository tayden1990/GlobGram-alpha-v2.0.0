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
    console.log('[LiveCall] Component mounted with room:', !!room);
    if (!room) {
      console.log('[LiveCall] No room provided, component will not function');
      return;
    }

    console.log('[LiveCall] Room details:', {
      state: (room as any).state,
      localParticipant: !!room.localParticipant,
      remoteParticipants: (room as any).participants?.size || 0
    });

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

    // --- WebRTC getStats polling with LiveKit v2.7.6 specific paths ---
    console.log('[LiveCall] Starting stats polling interval...');
    let lastStats: any = {};
    let statsAttempts = 0;
    const interval = setInterval(async () => {
      statsAttempts++;
      console.log(`[LiveCall] Stats polling attempt ${statsAttempts} started`);
      
      // LiveKit v2.7.6 specific peer connection detection
      let pc = null;
      let pcPath = 'none';
      let foundEngine = null;
      
      try {
        // Method 1: Access through Room.engine (most common in v2.7.6)
        const engine = (room as any).engine;
        if (engine) {
          foundEngine = engine;
          
          // Try primary transport in LiveKit v2.7.6
          if (engine.primaryTransport?.pc) {
            pc = engine.primaryTransport.pc;
            pcPath = 'engine.primaryTransport.pc';
          }
          // Try publisher/subscriber transports
          else if (engine.subscriberTransport?.pc) {
            pc = engine.subscriberTransport.pc;
            pcPath = 'engine.subscriberTransport.pc';
          }
          else if (engine.publisherTransport?.pc) {
            pc = engine.publisherTransport.pc;
            pcPath = 'engine.publisherTransport.pc';
          }
          // Legacy client structure
          else if (engine.client?._pc) {
            pc = engine.client._pc;
            pcPath = 'engine.client._pc';
          }
          else if (engine.client?.pc) {
            pc = engine.client.pc;
            pcPath = 'engine.client.pc';
          }
        }
        
        // Method 2: Check local participant engine
        if (!pc && room.localParticipant) {
          const lpEngine = (room.localParticipant as any).engine;
          if (lpEngine?.primaryTransport?.pc) {
            pc = lpEngine.primaryTransport.pc;
            pcPath = 'localParticipant.engine.primaryTransport.pc';
          }
        }
        
        // Method 3: Look through track publications for sender stats
        if (!pc && room.localParticipant) {
          const trackPubs = Array.from(room.localParticipant.trackPublications.values());
          for (const pub of trackPubs) {
            const track = (pub as any).track;
            if (track && track.sender?.transport?.pc) {
              pc = track.sender.transport.pc;
              pcPath = 'track.sender.transport.pc';
              break;
            }
            if (track && track.transceiver?.sender?.transport?.pc) {
              pc = track.transceiver.sender.transport.pc;
              pcPath = 'track.transceiver.sender.transport.pc';
              break;
            }
          }
        }
        
      } catch (e) {
        console.warn("Error accessing LiveKit engine:", e);
      }

      // Enhanced debugging for LiveKit v2.7.6 structure
      if (statsAttempts <= 3) {
        console.log(`[LiveCall Debug ${statsAttempts}] LiveKit v2.7.6 analysis:`, {
          hasRoom: !!room,
          roomConnectionState: (room as any).state,
          hasEngine: !!foundEngine,
          engineKeys: foundEngine ? Object.keys(foundEngine).slice(0, 15) : [],
          hasLocalParticipant: !!room.localParticipant,
          localParticipantTracks: room.localParticipant ? Array.from(room.localParticipant.trackPublications.keys()) : [],
          pcFound: !!pc,
          pcPath,
          pcType: pc ? pc.constructor.name : 'none',
          pcConnectionState: pc ? pc.connectionState : 'none',
          pcIceConnectionState: pc ? pc.iceConnectionState : 'none',
        });
        
        // Log engine structure for debugging
        if (foundEngine && statsAttempts === 1) {
          const engineStructure: any = {};
          try {
            engineStructure.hasPublisherTransport = !!foundEngine.publisherTransport;
            engineStructure.hasSubscriberTransport = !!foundEngine.subscriberTransport;
            engineStructure.hasPrimaryTransport = !!foundEngine.primaryTransport;
            engineStructure.hasClient = !!foundEngine.client;
            engineStructure.publisherKeys = foundEngine.publisherTransport ? Object.keys(foundEngine.publisherTransport).slice(0, 10) : [];
            engineStructure.subscriberKeys = foundEngine.subscriberTransport ? Object.keys(foundEngine.subscriberTransport).slice(0, 10) : [];
            engineStructure.primaryKeys = foundEngine.primaryTransport ? Object.keys(foundEngine.primaryTransport).slice(0, 10) : [];
          } catch {}
          console.log('[LiveCall] Engine structure:', engineStructure);
        }
      }

      let videoBitrate = 0;
      let audioBitrate = 0;
      let fps = 0;
      let foundStats = false;
      let statsDetails: any = {};

      if (pc && typeof pc.getStats === "function" && pc.connectionState === "connected") {
        try {
          const stats = await pc.getStats();
          let reportCount = 0;
          let outboundReports: any[] = [];
          let inboundReports: any[] = [];
          
          stats.forEach((report: any) => {
            reportCount++;
            
            // Track outbound (sending) stats
            if (report.type === "outbound-rtp") {
              outboundReports.push({
                kind: report.kind,
                bytesSent: report.bytesSent,
                framesPerSecond: report.framesPerSecond,
                packetsSent: report.packetsSent,
                id: report.id,
                ssrc: report.ssrc
              });
              
              if (report.kind === "video") {
                foundStats = true;
                setDataSource('real');
                if (lastStats[report.id]) {
                  const bytes = report.bytesSent - lastStats[report.id].bytesSent;
                  videoBitrate = Math.round((bytes * 8) / 2 / 1000); // kbps, 2s interval
                  if (report.framesPerSecond) fps = report.framesPerSecond;
                }
                lastStats[report.id] = { bytesSent: report.bytesSent };
              }
              if (report.kind === "audio") {
                foundStats = true;
                if (lastStats[report.id]) {
                  const bytes = report.bytesSent - lastStats[report.id].bytesSent;
                  audioBitrate = Math.round((bytes * 8) / 2 / 1000); // kbps
                }
                lastStats[report.id] = { bytesSent: report.bytesSent };
              }
            }
            
            // Also track inbound (receiving) stats for debugging
            if (report.type === "inbound-rtp") {
              inboundReports.push({
                kind: report.kind,
                bytesReceived: report.bytesReceived,
                packetsReceived: report.packetsReceived,
                id: report.id
              });
            }
          });
          
          statsDetails = { 
            reportCount, 
            outboundReports: outboundReports.slice(0, 3),
            inboundReports: inboundReports.slice(0, 3),
            pcState: pc.connectionState,
            iceState: pc.iceConnectionState
          };
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

      // Enhanced debug logging for LiveKit v2.7.6
      if (statsAttempts <= 8) {
        console.log(`[LiveCall Stats ${statsAttempts}]:`, {
          pcFound: !!pc,
          pcPath,
          pcConnectionState: pc ? pc.connectionState : 'none',
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
    <div style={{ 
      padding: "24px",
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
      color: "#ffffff",
      borderRadius: "16px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    }}>
      {/* Video Section */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "32px" }}>
        <div>
          <h2 style={{ 
            margin: "0 0 12px 0", 
            fontSize: "18px", 
            fontWeight: "600",
            color: "#e2e8f0"
          }}>Local Video</h2>
          <video 
            ref={localVideoRef} 
            autoPlay 
            muted 
            playsInline 
            style={{ 
              width: "100%", 
              maxWidth: "300px",
              height: "auto",
              borderRadius: "12px",
              border: "2px solid #374151",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)"
            }} 
          />
        </div>
        
        <div>
          <h2 style={{ 
            margin: "0 0 12px 0", 
            fontSize: "18px", 
            fontWeight: "600",
            color: "#e2e8f0"
          }}>Remote Video</h2>
          <video 
            ref={remoteVideoRef} 
            autoPlay 
            playsInline 
            style={{ 
              width: "100%", 
              maxWidth: "300px",
              height: "auto",
              borderRadius: "12px",
              border: "2px solid #374151",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)"
            }} 
          />
        </div>
      </div>

      {/* Stats Section */}
      <div style={{ marginBottom: "24px" }}>
        <h3 style={{ 
          margin: "0 0 16px 0", 
          fontSize: "20px", 
          fontWeight: "600",
          color: "#f1f5f9",
          display: "flex",
          alignItems: "center",
          gap: "12px"
        }}>
          Live Stats (last 30 points)
          <span style={{ 
            fontSize: '13px', 
            padding: '6px 12px', 
            borderRadius: '20px',
            fontWeight: "500",
            background: dataSource === 'real' ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)' : 
                       dataSource === 'mock' ? 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)' : 
                       'linear-gradient(135deg, #6b7280 0%, #9ca3af 100%)',
            color: '#ffffff',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            {dataSource === 'real' ? '🟢 Real WebRTC Data' : 
             dataSource === 'mock' ? '🟡 Mock Data' : '⚪ No Data'}
          </span>
        </h3>
        
        <div style={{
          background: "rgba(255, 255, 255, 0.05)",
          borderRadius: "16px",
          padding: "20px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          backdropFilter: "blur(10px)"
        }}>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={statsHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
              <XAxis 
                dataKey="time" 
                stroke="#94a3b8"
                fontSize={12}
                tick={{ fill: '#94a3b8' }}
              />
              <YAxis 
                stroke="#94a3b8"
                fontSize={12}
                tick={{ fill: '#94a3b8' }}
              />
              <Tooltip 
                contentStyle={{
                  background: "rgba(15, 23, 42, 0.95)",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  borderRadius: "12px",
                  color: "#ffffff",
                  backdropFilter: "blur(10px)"
                }}
                labelStyle={{ color: "#e2e8f0" }}
              />
              <Legend 
                wrapperStyle={{ color: "#e2e8f0" }}
              />
              <Line 
                type="monotone" 
                dataKey="videoBitrate" 
                stroke="#3b82f6" 
                strokeWidth={3}
                dot={{ fill: "#3b82f6", strokeWidth: 2, r: 4 }}
                name="Video Bitrate (kbps)" 
              />
              <Line 
                type="monotone" 
                dataKey="audioBitrate" 
                stroke="#10b981" 
                strokeWidth={3}
                dot={{ fill: "#10b981", strokeWidth: 2, r: 4 }}
                name="Audio Bitrate (kbps)" 
              />
              <Line 
                type="monotone" 
                dataKey="fps" 
                stroke="#f59e0b" 
                strokeWidth={3}
                dot={{ fill: "#f59e0b", strokeWidth: 2, r: 4 }}
                name="FPS" 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Alerts Section */}
      <div>
        <h3 style={{ 
          margin: "0 0 16px 0", 
          fontSize: "20px", 
          fontWeight: "600",
          color: "#f1f5f9"
        }}>Alerts</h3>
        <div style={{ 
          maxHeight: "200px", 
          overflowY: "auto", 
          background: "rgba(239, 68, 68, 0.1)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          borderRadius: "12px",
          padding: "16px",
          backdropFilter: "blur(10px)"
        }}>
          {alerts.length === 0 ? (
            <div style={{ 
              color: "#94a3b8", 
              fontStyle: "italic",
              textAlign: "center",
              padding: "20px"
            }}>
              No alerts - call quality is good 📊
            </div>
          ) : (
            alerts.map((alert, idx) => (
              <div 
                key={idx} 
                style={{ 
                  color: "#fef2f2",
                  background: "rgba(239, 68, 68, 0.2)",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  marginBottom: idx < alerts.length - 1 ? "8px" : "0",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  fontSize: "14px",
                  fontWeight: "500"
                }}
              >
                {alert}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default LiveCall;
