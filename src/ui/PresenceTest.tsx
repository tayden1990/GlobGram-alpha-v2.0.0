import React, { useEffect } from 'react'
import { usePresenceStore } from '../state/presenceStore'

export function PresenceTestComponent() {
  const { 
    addCallInvitation, 
    setRoomBlinking, 
    setRoomCallActive,
    blinkingRooms,
    pendingInvitations 
  } = usePresenceStore()
  
  // Test function to simulate a call invitation
  const testCallInvitation = () => {
    const testRoomId = 'test-room-123'
    
    // Create a test invitation
    addCallInvitation({
      id: `test-${Date.now()}`,
      roomId: testRoomId,
      fromUserId: 'test-user-456',
      fromUserName: 'Test User',
      createdAt: Date.now(),
      status: 'pending'
    })
    
    // Set room blinking
    setRoomBlinking(testRoomId, true)
    
    console.log('Test call invitation created for room:', testRoomId)
  }
  
  return (
    <div style={{ 
      position: 'fixed', 
      bottom: 20, 
      right: 20, 
      background: 'var(--card)', 
      border: '1px solid var(--border)', 
      borderRadius: 8, 
      padding: 12,
      fontSize: 12,
      zIndex: 1000
    }}>
      <h4 style={{ margin: '0 0 8px' }}>Presence System Test</h4>
      <div>Blinking rooms: {Array.from(blinkingRooms).length}</div>
      <div>Pending invitations: {pendingInvitations.length}</div>
      <button 
        onClick={testCallInvitation}
        style={{ 
          marginTop: 8, 
          padding: '4px 8px', 
          fontSize: 10,
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer'
        }}
      >
        Test Call Invitation
      </button>
    </div>
  )
}
