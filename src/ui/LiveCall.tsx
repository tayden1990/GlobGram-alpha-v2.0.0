import React, { useEffect, useRef, useState } from "react";
import { Room, RemoteParticipant, Track } from "livekit-client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";
import './video-stabilization.css';
import { stabilizeVideo, VideoStabilizer } from './videoStabilizer';

interface LiveCallProps {
  room: Room;
}

interface StatPoint {
  time: string;
  videoBitrate: number;
  audioBitrate: number;
  fps: number;
}

const VIDEO_BITRATE_THRESHOLD = 150; // kbps - more realistic for poor network conditions
const FPS_THRESHOLD = 10; // fps - more realistic threshold
const AUDIO_BITRATE_THRESHOLD = 20; // kbps - realistic for speech

const LiveCall: React.FC<LiveCallProps> = ({ room }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStabilizerRef = useRef<VideoStabilizer | null>(null);
  const remoteStabilizerRef = useRef<VideoStabilizer | null>(null);

  const [statsHistory, setStatsHistory] = useState<StatPoint[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [dataSource, setDataSource] = useState<'real' | 'mock' | 'none'>('none');
  const [networkQuality, setNetworkQuality] = useState<{
    uplink: number;
    downlink: number;
    rtt: number;
    packetLoss: number;
  } | null>(null);

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

    // Attach local video (camera) with stabilization
    const localCamPub = Array.from(room.localParticipant.trackPublications.values()).find(
      (pub: any) => pub.source === Track.Source.Camera
    );
    if (localCamPub && localCamPub.track && localVideoRef.current) {
      localCamPub.track.attach(localVideoRef.current);
      
        // Apply video stabilization settings (more aggressive)
        const videoElement = localVideoRef.current;
        videoElement.style.objectFit = 'cover';
        videoElement.style.transform = 'scale(1.0)'; // Prevent scaling jumps
        videoElement.style.transition = 'none'; // Remove any CSS transitions that could cause jumps
        videoElement.style.imageRendering = 'auto';
        videoElement.style.backfaceVisibility = 'hidden';
        (videoElement.style as any).webkitBackfaceVisibility = 'hidden';
        videoElement.style.willChange = 'auto';
        
        // Force video element size to prevent jumping
        videoElement.style.minWidth = '300px';
        videoElement.style.minHeight = '169px'; // 16:9 ratio
        videoElement.style.maxWidth = '300px';
        videoElement.style.maxHeight = '169px';
        
        // Add frame stabilization event listeners
        videoElement.addEventListener('loadedmetadata', () => {
          console.log('[LiveCall] Video metadata loaded, dimensions:', videoElement.videoWidth, 'x', videoElement.videoHeight);
        });
        
        videoElement.addEventListener('resize', (e) => {
          console.log('[LiveCall] Video resize detected - preventing jumps');
          e.preventDefault();
        });
        
        // Apply advanced video stabilization
        if (localStabilizerRef.current) {
          localStabilizerRef.current.destroy();
        }
        localStabilizerRef.current = stabilizeVideo(videoElement);      // Set video track constraints for maximum stability
      const mediaTrack = (localCamPub.track as any).mediaStreamTrack;
      if (mediaTrack && mediaTrack.applyConstraints) {
        (async () => {
          try {
            await mediaTrack.applyConstraints({
              width: { exact: 960 },           // Force exact resolution
              height: { exact: 540 },          // Force exact resolution
              frameRate: { exact: 30 },        // Force exact framerate
              aspectRatio: { exact: 16/9 },    // Force exact aspect ratio
              resizeMode: 'none',              // Prevent resizing
              latency: { max: 0.1 },           // Low latency
            });
            
            // Force video track settings
            const settings = mediaTrack.getSettings();
            console.log('[LiveCall] Applied video constraints:', settings);
            
          } catch (e) {
            console.warn('Failed to apply strict video constraints, trying relaxed:', e);
            try {
              await mediaTrack.applyConstraints({
                width: { ideal: 960, min: 640, max: 960 },
                height: { ideal: 540, min: 360, max: 540 },
                frameRate: { ideal: 30, min: 30, max: 30 },
                aspectRatio: { ideal: 16/9 }
              });
            } catch (e2) {
              console.warn('Failed to apply any video constraints:', e2);
            }
          }
        })();
      }
    }

    // Attach remote video for the first participant (if any) with stabilization
    const attachRemoteVideo = (participant: RemoteParticipant) => {
      const videoPub = Array.from(participant.trackPublications.values()).find(
        (pub: any) => pub.kind === "video" && pub.track
      );
      if (videoPub && videoPub.track && remoteVideoRef.current) {
        videoPub.track.attach(remoteVideoRef.current);
        
        // Apply stabilization to remote video
        const videoElement = remoteVideoRef.current;
        videoElement.style.objectFit = 'cover';
        videoElement.style.transform = 'scale(1.0)';
        videoElement.style.transition = 'none';
        
        // Apply advanced stabilization to remote video
        if (remoteStabilizerRef.current) {
          remoteStabilizerRef.current.destroy();
        }
        remoteStabilizerRef.current = stabilizeVideo(videoElement);
      }
      
      participant.on("trackSubscribed", (track: Track) => {
        if (track.kind === "video" && remoteVideoRef.current) {
          track.attach(remoteVideoRef.current);
          
          // Apply stabilization to newly subscribed tracks
          const videoElement = remoteVideoRef.current;
          videoElement.style.objectFit = 'cover';
          videoElement.style.transform = 'scale(1.0)';
          videoElement.style.transition = 'none';
          
          // Re-apply advanced stabilization
          if (remoteStabilizerRef.current) {
            remoteStabilizerRef.current.destroy();
          }
          remoteStabilizerRef.current = stabilizeVideo(videoElement);
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
        console.log(`[LiveCall Debug ${statsAttempts}] Starting peer connection search...`);
        
        // Method 1: Access through Room.engine (most common in v2.7.6)
        const engine = (room as any).engine;
        if (engine) {
          foundEngine = engine;
          console.log(`[LiveCall Debug ${statsAttempts}] Found engine:`, Object.keys(engine));
          
          // Check all possible transport locations
          const transports = [
            { path: 'primaryTransport', obj: engine.primaryTransport },
            { path: 'subscriberTransport', obj: engine.subscriberTransport },
            { path: 'publisherTransport', obj: engine.publisherTransport },
            { path: 'client._pc', obj: engine.client?._pc },
            { path: 'client.pc', obj: engine.client?.pc }
          ];
          
          for (const transport of transports) {
            if (transport.obj?.pc) {
              pc = transport.obj.pc;
              pcPath = `engine.${transport.path}.pc`;
              console.log(`[LiveCall Debug ${statsAttempts}] Found PC at: ${pcPath}`);
              break;
            }
            if (transport.obj && typeof transport.obj.getStats === 'function') {
              pc = transport.obj;
              pcPath = `engine.${transport.path}`;
              console.log(`[LiveCall Debug ${statsAttempts}] Found PC directly at: ${pcPath}`);
              break;
            }
          }
        }
        
        // Method 2: Check local participant engine
        if (!pc && room.localParticipant) {
          console.log(`[LiveCall Debug ${statsAttempts}] Checking localParticipant...`);
          const lpEngine = (room.localParticipant as any).engine;
          if (lpEngine?.primaryTransport?.pc) {
            pc = lpEngine.primaryTransport.pc;
            pcPath = 'localParticipant.engine.primaryTransport.pc';
            console.log(`[LiveCall Debug ${statsAttempts}] Found PC in localParticipant`);
          }
        }
        
        // Method 3: Check for RTCPeerConnection objects anywhere in room
        if (!pc) {
          console.log(`[LiveCall Debug ${statsAttempts}] Deep searching for RTCPeerConnection...`);
          const searchForPC = (obj: any, path: string, depth: number = 0): any => {
            if (depth > 3) return null; // Prevent infinite recursion
            
            for (const key in obj) {
              try {
                const value = obj[key];
                if (value && value.constructor && value.constructor.name === 'RTCPeerConnection') {
                  console.log(`[LiveCall Debug ${statsAttempts}] Found RTCPeerConnection at: ${path}.${key}`);
                  return { pc: value, path: `${path}.${key}` };
                }
                if (typeof value === 'object' && value !== null && depth < 3) {
                  const result = searchForPC(value, `${path}.${key}`, depth + 1);
                  if (result) return result;
                }
              } catch {}
            }
            return null;
          };
          
          const result = searchForPC(room, 'room');
          if (result) {
            pc = result.pc;
            pcPath = result.path;
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
      let rtt = 0;
      let packetLoss = 0;
      let foundStats = false;
      let statsDetails: any = {};

      if (pc && typeof pc.getStats === "function") {
        console.log(`[LiveCall Debug ${statsAttempts}] Found valid PC with getStats, connection state: ${pc.connectionState}, ice state: ${pc.iceConnectionState}`);
        
        // Try to get stats if connection is established or connecting (be more permissive)
        if (['connected', 'connecting', 'new', 'checking'].includes(pc.connectionState) || 
            ['connected', 'checking', 'new', 'completed'].includes(pc.iceConnectionState)) {
          try {
            const stats = await pc.getStats();
            let reportCount = 0;
            let outboundReports: any[] = [];
            let inboundReports: any[] = [];
            
            console.log(`[LiveCall Debug ${statsAttempts}] Got stats object with ${stats.size} reports`);
            
            stats.forEach((report: any) => {
              reportCount++;
              if (statsAttempts <= 3) {
                console.log(`[LiveCall Debug ${statsAttempts}] Report ${reportCount}: ${report.type} - ${report.kind || 'no-kind'} - ssrc: ${report.ssrc || 'none'}`);
              }
              
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
                
                if (statsAttempts <= 3) {
                  console.log(`[LiveCall Debug ${statsAttempts}] Found outbound-rtp: ${report.kind}, bytes: ${report.bytesSent}, fps: ${report.framesPerSecond}`);
                }
                
                if (report.kind === "video") {
                  foundStats = true;
                  setDataSource('real');
                  if (lastStats[report.id]) {
                    const bytes = report.bytesSent - lastStats[report.id].bytesSent;
                    videoBitrate = Math.round((bytes * 8) / 2 / 1000); // kbps, 2s interval
                    if (report.framesPerSecond) fps = report.framesPerSecond;
                    console.log(`[LiveCall Debug ${statsAttempts}] Calculated video bitrate: ${videoBitrate} kbps, fps: ${fps}`);
                  }
                  lastStats[report.id] = { bytesSent: report.bytesSent };
                }
                if (report.kind === "audio") {
                  foundStats = true;
                  if (lastStats[report.id]) {
                    const bytes = report.bytesSent - lastStats[report.id].bytesSent;
                    audioBitrate = Math.round((bytes * 8) / 2 / 1000); // kbps
                    console.log(`[LiveCall Debug ${statsAttempts}] Calculated audio bitrate: ${audioBitrate} kbps`);
                  }
                  lastStats[report.id] = { bytesSent: report.bytesSent };
                }
              }
              
              // Track network quality indicators
              if (report.type === "remote-inbound-rtp" && report.kind === "video") {
                if (report.roundTripTime) rtt = Math.round(report.roundTripTime * 1000); // ms
                if (report.fractionLost) packetLoss = Math.round(report.fractionLost * 100); // %
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
            
            console.log(`[LiveCall Debug ${statsAttempts}] Stats summary: ${outboundReports.length} outbound, ${inboundReports.length} inbound, foundStats: ${foundStats}`);
            
            statsDetails = { 
              reportCount, 
              outboundReports: outboundReports.slice(0, 3),
              inboundReports: inboundReports.slice(0, 3),
              pcState: pc.connectionState,
              iceState: pc.iceConnectionState
            };
          } catch (e) {
            console.warn(`[LiveCall Debug ${statsAttempts}] getStats failed:`, e);
            statsDetails = { error: e instanceof Error ? e.message : String(e) };
          }
        } else {
          console.log(`[LiveCall Debug ${statsAttempts}] PC not ready for stats: connection=${pc.connectionState}, ice=${pc.iceConnectionState}`);
          statsDetails = { 
            pcState: pc.connectionState,
            iceState: pc.iceConnectionState,
            waiting: 'connection not ready'
          };
        }
      } else if (pc) {
        console.log(`[LiveCall Debug ${statsAttempts}] Found PC but no getStats method:`, typeof pc.getStats);
      } else {
        console.log(`[LiveCall Debug ${statsAttempts}] No peer connection found`);
      }

      // Fallback: generate mock data if no real stats found after 30 attempts (60 seconds)
      if (!foundStats && statsAttempts > 30) {
        console.log(`[LiveCall Debug ${statsAttempts}] Using mock data fallback after ${statsAttempts} attempts`);
        setDataSource('mock');
        videoBitrate = Math.floor(Math.random() * 500) + 200; // 200-700 kbps
        audioBitrate = Math.floor(Math.random() * 50) + 20;   // 20-70 kbps
        fps = Math.floor(Math.random() * 10) + 20;           // 20-30 fps
        rtt = 0;
        packetLoss = 0;
      }

      // Update network quality
      if (rtt > 0 || packetLoss > 0) {
        setNetworkQuality({
          uplink: videoBitrate + audioBitrate,
          downlink: 0, // We don't track downlink in this setup
          rtt,
          packetLoss
        });
      }

      const time = new Date().toLocaleTimeString();
      const newPoint = { time, videoBitrate, audioBitrate, fps };
      setStatsHistory((prev) => [...prev.slice(-29), newPoint]);

      // Enhanced alerts with quality recommendations
      const newAlerts: string[] = [];
      
      if (videoBitrate && videoBitrate < VIDEO_BITRATE_THRESHOLD) {
        let recommendation = "";
        if (videoBitrate < 50) {
          recommendation = " - Critical: Check network connection";
        } else if (videoBitrate < 100) {
          recommendation = " - Consider reducing video quality";
        } else {
          recommendation = " - Poor network conditions detected";
        }
        newAlerts.push(`⚠️ Low video bitrate: ${videoBitrate} kbps${recommendation} at ${time}`);
      }
      
      if (fps && fps < FPS_THRESHOLD) {
        let recommendation = "";
        if (fps < 5) {
          recommendation = " - Critical: Video may be unwatchable";
        } else if (fps < 8) {
          recommendation = " - Very choppy video experience";
        } else {
          recommendation = " - Slightly choppy video";
        }
        newAlerts.push(`⚠️ Low FPS: ${fps}${recommendation} at ${time}`);
      }
      
      if (audioBitrate && audioBitrate < AUDIO_BITRATE_THRESHOLD) {
        newAlerts.push(`⚠️ Low audio bitrate: ${audioBitrate} kbps - Audio may be unclear at ${time}`);
      }
      
      if (rtt > 500) {
        newAlerts.push(`⚠️ High latency: ${rtt}ms - Conversation delays expected at ${time}`);
      }
      
      if (packetLoss > 5) {
        newAlerts.push(`⚠️ Packet loss: ${packetLoss}% - Audio/video artifacts likely at ${time}`);
      }
      
      // Quality improvement suggestions (shown less frequently)
      if (statsAttempts % 10 === 0 && (videoBitrate < 200 || fps < 15)) {
        newAlerts.push(`💡 Tip: Close other apps, move closer to router, or switch to audio-only mode`);
      }
      
      if (newAlerts.length > 0) {
        setAlerts((prev) => [...prev, ...newAlerts].slice(-100)); // Keep more alerts for better tracking
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
          dataSource: foundStats ? 'real' : (statsAttempts > 15 ? 'mock' : 'searching')
        });
      }
    }, 2000);

    // Cleanup
    return () => {
      clearInterval(interval);
      room.off("participantConnected", attachRemoteVideo);
      
      // Cleanup video stabilizers
      if (localStabilizerRef.current) {
        localStabilizerRef.current.destroy();
        localStabilizerRef.current = null;
      }
      if (remoteStabilizerRef.current) {
        remoteStabilizerRef.current.destroy();
        remoteStabilizerRef.current = null;
      }
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
            className="stable-video"
            style={{ 
              width: "100%", 
              maxWidth: "300px",
              height: "auto",
              borderRadius: "12px",
              border: "2px solid #374151",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
              objectFit: "cover",
              transform: "translateZ(0)",
              transition: "none",
              backfaceVisibility: "hidden",
              willChange: "auto"
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
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
              objectFit: "cover",
              transform: "scale(1.0)",
              transition: "none",
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              willChange: "auto"
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

      {/* Network Quality Section */}
      {networkQuality && (
        <div>
          <h3 style={{ 
            margin: "0 0 16px 0", 
            fontSize: "20px", 
            fontWeight: "600",
            color: "#f1f5f9"
          }}>Network Quality</h3>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "24px"
          }}>
            <div style={{
              background: "rgba(59, 130, 246, 0.1)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              borderRadius: "12px",
              padding: "16px",
              textAlign: "center"
            }}>
              <div style={{ fontSize: "24px", fontWeight: "700", color: "#3b82f6", marginBottom: "4px" }}>
                {networkQuality.uplink} kbps
              </div>
              <div style={{ fontSize: "12px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px" }}>
                Upload Speed
              </div>
            </div>
            <div style={{
              background: networkQuality.rtt > 200 ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.1)",
              border: `1px solid ${networkQuality.rtt > 200 ? "rgba(239, 68, 68, 0.3)" : "rgba(16, 185, 129, 0.3)"}`,
              borderRadius: "12px",
              padding: "16px",
              textAlign: "center"
            }}>
              <div style={{ 
                fontSize: "24px", 
                fontWeight: "700", 
                color: networkQuality.rtt > 200 ? "#ef4444" : "#10b981", 
                marginBottom: "4px" 
              }}>
                {networkQuality.rtt}ms
              </div>
              <div style={{ fontSize: "12px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px" }}>
                Latency
              </div>
            </div>
            {networkQuality.packetLoss > 0 && (
              <div style={{
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "12px",
                padding: "16px",
                textAlign: "center",
                gridColumn: "span 2"
              }}>
                <div style={{ fontSize: "24px", fontWeight: "700", color: "#ef4444", marginBottom: "4px" }}>
                  {networkQuality.packetLoss}%
                </div>
                <div style={{ fontSize: "12px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px" }}>
                  Packet Loss
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
