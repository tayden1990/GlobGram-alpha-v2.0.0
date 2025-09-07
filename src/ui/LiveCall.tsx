
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



    // Use LiveKit's getStats API
    const pollStats = async () => {
      if (!room.engine || !(room.engine.client as any).getStats) return;
      const stats = await (room.engine.client as any).getStats();
      // Example stats: { outboundVideoBitrate, outboundAudioBitrate, outboundFrameRate }
      const videoBitrate = Math.round(stats.outboundVideoBitrate ?? 0);
      const fps = Math.round(stats.outboundFrameRate ?? 0);
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

      <h3 style={{ color: '#f5f5f5', marginTop: 24 }}>Local Video Stats (last 30 points)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={statsHistory}>
          <CartesianGrid strokeDasharray="3 3" stroke="#555" />
          <XAxis dataKey="time" stroke="#f5f5f5" tick={{ fill: '#f5f5f5' }} />
          <YAxis stroke="#f5f5f5" tick={{ fill: '#f5f5f5' }} />
          <Tooltip contentStyle={{ background: '#23272f', color: '#f5f5f5', border: '1px solid #888' }} labelStyle={{ color: '#f5f5f5' }} />
          <Legend wrapperStyle={{ color: '#f5f5f5' }} />
          <Line type="monotone" dataKey="videoBitrate" stroke="#4fc3f7" name="Video Bitrate (kbps)" dot={false} />
          <Line type="monotone" dataKey="fps" stroke="#ffd54f" name="FPS" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default LiveCall;
