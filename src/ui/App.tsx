import { KeyManager } from '../wallet'
import { ChatList, ChatWindow, NostrEngine, RelayManager, RoomList, RoomWindow } from '.'

export default function App() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <h1>GlobGram Alpha</h1>
  <p style={{ marginTop: -8 }}>Decentralized DMs over Nostr relays (NIP-04). Rooms (experimental).</p>
  <KeyManager />
  <RelayManager />
      <div style={{ display: 'flex', flex: 1, border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', margin: 16 }}>
        <NostrEngine />
        <div style={{ display: 'flex', flex: 1 }}>
          <ChatList />
          <ChatWindow />
        </div>
        <div style={{ width: 1, background: '#eee' }} />
        <div style={{ display: 'flex', flex: 1 }}>
          <RoomList />
          <RoomWindow />
        </div>
      </div>
    </div>
  )
}
