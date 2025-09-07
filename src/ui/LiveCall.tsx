
import React, { useEffect, useRef, useState } from "react";
import { Room, RemoteParticipant, Track } from "livekit-client";
import { TrackPublication } from "livekit-client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";



interface LiveCallProps {
  room: Room;
}



const VIDEO_BITRATE_THRESHOLD = 300; // kbps
const FPS_THRESHOLD = 15; // fps


const LiveCall: React.FC<LiveCallProps> = ({ room }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [statsHistory, setStatsHistory] = useState<{ time: string; videoBitrate: number; fps: number }[]>([]);

  useEffect(() => {
    if (!room) return;

    // Attach local video
    const localVideoPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (localVideoPub && localVideoPub.track && localVideoRef.current) {
      localVideoPub.track.attach(localVideoRef.current);
    }

    // Attach remote video for first participant (for demo)
    const attachRemote = (participant: RemoteParticipant) => {
      participant.getTrackPublications().forEach((pub: TrackPublication) => {
        const track = pub.track;
        if (track && track.kind === 'video' && remoteVideoRef.current) {
          track.attach(remoteVideoRef.current);
        }
      });
      participant.on('trackSubscribed', (track: Track) => {
        if (track.kind === 'video' && remoteVideoRef.current) {
          track.attach(remoteVideoRef.current);
        }
      });
    };
    room.remoteParticipants.forEach(attachRemote);
    room.on('participantConnected', attachRemote);

    let interval: NodeJS.Timeout | undefined;


    // Helper to poll local video stats using RTCPeerConnection
    const pollStats = async () => {
      // Try to access the peer connection (may need to adjust for your SDK)
      // This is a common pattern for LiveKit JS SDK, but may change in future versions
  const pc = (room.engine && room.engine.client && (room.engine.client as any)._pc) as RTCPeerConnection | undefined;
  if (!pc) return;
  const senders = pc.getSenders();
  const videoSender = senders.find((s: RTCRtpSender) => s.track && s.track.kind === 'video');
      if (!videoSender) return;
      const stats = await videoSender.getStats();
      let videoBitrate = 0;
      let fps = 0;
      stats.forEach((report: any) => {
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          // Bitrate calculation: you may need to calculate delta over time for true bitrate
          if (typeof report.bytesSent === 'number' && typeof report.timestamp === 'number') {
            // For demo, just show bytesSent (not true bitrate)
            videoBitrate = Math.round(report.bytesSent / 1000);
          }
          if (typeof report.framesPerSecond === 'number') {
            fps = Math.round(report.framesPerSecond);
          }
        }
      });
      const time = new Date().toLocaleTimeString();
      setStatsHistory(prev => [...prev.slice(-29), { time, videoBitrate, fps }]);
    };

    interval = setInterval(pollStats, 2000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [room]);

  return (
    <div style={{ padding: "20px" }}>
      <h2>Local Video</h2>
      <video ref={localVideoRef} autoPlay muted playsInline style={{ width: "300px", border: "1px solid gray" }} />

      <h2>Remote Video</h2>
      <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "300px", border: "1px solid gray" }} />

      <h3 style={{ color: '#222', marginTop: 24 }}>Local Video Stats (last 30 points)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={statsHistory}>
          <CartesianGrid strokeDasharray="3 3" stroke="#bbb" />
          <XAxis dataKey="time" stroke="#222" tick={{ fill: '#222' }} />
          <YAxis stroke="#222" tick={{ fill: '#222' }} />
          <Tooltip contentStyle={{ background: '#fff', color: '#222', border: '1px solid #888' }} labelStyle={{ color: '#222' }} />
          <Legend wrapperStyle={{ color: '#222' }} />
          <Line type="monotone" dataKey="videoBitrate" stroke="#1976d2" name="Video Bitrate (kbps)" dot={false} />
          <Line type="monotone" dataKey="fps" stroke="#d2691e" name="FPS" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default LiveCall;
