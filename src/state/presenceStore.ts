import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type RoomPresence = {
  roomId: string
  userId: string
  joinedAt: number
  lastHeartbeat: number
  isInCall?: boolean
}

export type CallInvitation = {
  id: string
  roomId: string
  fromUserId: string
  fromUserName?: string
  createdAt: number
  status: 'pending' | 'accepted' | 'rejected' | 'expired'
  seen?: boolean // Track if user has seen this notification
  dismissed?: boolean // Track if user has dismissed this notification
}

export type ActiveCall = {
  roomId: string
  startedAt: number
  participants: string[]
  isMinimized: boolean
  shareableLink?: string
}

type State = {
  // Room presence tracking
  roomPresence: Record<string, RoomPresence[]> // roomId -> array of users present
  myPresence: Record<string, RoomPresence> // roomId -> my presence in room
  
  // Call invitations and notifications
  pendingInvitations: CallInvitation[]
  seenNotifications: Set<string> // Track seen notification IDs
  dismissedNotifications: Set<string> // Track dismissed notification IDs
  activeCallRooms: Set<string> // rooms with active calls
  
  // Active call management
  activeCalls: Record<string, ActiveCall> // roomId -> call info
  currentCallRoomId: string | null // currently active call
  
  // Blinking alarm states
  blinkingRooms: Set<string> // rooms with blinking alarms
}

type Actions = {
  // Presence management
  setRoomPresence: (roomId: string, presence: RoomPresence[]) => void
  addUserToRoom: (roomId: string, presence: RoomPresence) => void
  removeUserFromRoom: (roomId: string, userId: string) => void
  updateMyPresence: (roomId: string, presence: Partial<RoomPresence>) => void
  clearMyPresence: (roomId: string) => void
  
  // Call invitations
  addCallInvitation: (invitation: CallInvitation) => void
  updateCallInvitation: (id: string, updates: Partial<CallInvitation>) => void
  removeCallInvitation: (id: string) => void
  clearExpiredInvitations: () => void
  
  // Notification management
  markNotificationSeen: (id: string) => void
  markNotificationDismissed: (id: string) => void
  isNotificationSeen: (id: string) => boolean
  isNotificationDismissed: (id: string) => boolean
  getUnseenInvitations: () => CallInvitation[]
  clearSeenNotifications: () => void
  
  // Call room management
  setRoomCallActive: (roomId: string, active: boolean) => void
  
  // Active call management
  startCall: (roomId: string, participants: string[]) => void
  endCall: (roomId: string) => void
  updateCallParticipants: (roomId: string, participants: string[]) => void
  setCallMinimized: (roomId: string, minimized: boolean) => void
  setCurrentCall: (roomId: string | null) => void
  generateShareableLink: (roomId: string) => string
  
  // Blinking alarm management
  setRoomBlinking: (roomId: string, blinking: boolean) => void
  clearAllBlinking: () => void
  
  // Utility functions
  getRoomUserCount: (roomId: string) => number
  isRoomActive: (roomId: string) => boolean
  hasActiveCall: (roomId: string) => boolean
  getPendingInvitationsForRoom: (roomId: string) => CallInvitation[]
  getCurrentCall: () => ActiveCall | null
}

export const usePresenceStore = create<State & Actions>()(
  persist<State & Actions>(
    (set, get) => ({
      roomPresence: {},
      myPresence: {},
      pendingInvitations: [],
      seenNotifications: new Set(),
      dismissedNotifications: new Set(),
      activeCallRooms: new Set(),
      activeCalls: {},
      currentCallRoomId: null,
      blinkingRooms: new Set(),
      
      setRoomPresence: (roomId, presence) => {
        set((state) => ({
          roomPresence: {
            ...state.roomPresence,
            [roomId]: presence
          }
        }))
      },
      
      addUserToRoom: (roomId, presence) => {
        set((state) => {
          const currentPresence = state.roomPresence[roomId] || []
          const existingIndex = currentPresence.findIndex(p => p.userId === presence.userId)
          
          let newPresence
          if (existingIndex >= 0) {
            // Update existing presence
            newPresence = [...currentPresence]
            newPresence[existingIndex] = presence
          } else {
            // Add new presence
            newPresence = [...currentPresence, presence]
          }
          
          return {
            roomPresence: {
              ...state.roomPresence,
              [roomId]: newPresence
            }
          }
        })
      },
      
      removeUserFromRoom: (roomId, userId) => {
        set((state) => {
          const currentPresence = state.roomPresence[roomId] || []
          const newPresence = currentPresence.filter(p => p.userId !== userId)
          
          return {
            roomPresence: {
              ...state.roomPresence,
              [roomId]: newPresence
            }
          }
        })
      },
      
      updateMyPresence: (roomId, presence) => {
        set((state) => {
          const current = state.myPresence[roomId]
          const updated = { ...current, ...presence }
          
          return {
            myPresence: {
              ...state.myPresence,
              [roomId]: updated
            }
          }
        })
      },
      
      clearMyPresence: (roomId) => {
        set((state) => {
          const newPresence = { ...state.myPresence }
          delete newPresence[roomId]
          return { myPresence: newPresence }
        })
      },
      
      addCallInvitation: (invitation) => {
        set((state) => ({
          pendingInvitations: [...state.pendingInvitations, invitation]
        }))
      },
      
      updateCallInvitation: (id, updates) => {
        set((state) => ({
          pendingInvitations: state.pendingInvitations.map(inv => 
            inv.id === id ? { ...inv, ...updates } : inv
          )
        }))
      },
      
      removeCallInvitation: (id) => {
        set((state) => ({
          pendingInvitations: state.pendingInvitations.filter(inv => inv.id !== id)
        }))
      },
      
      clearExpiredInvitations: () => {
        const now = Date.now()
        const EXPIRY_TIME = 45000 // 45 seconds
        
        set((state) => ({
          pendingInvitations: state.pendingInvitations.filter(inv => 
            now - inv.createdAt < EXPIRY_TIME && inv.status === 'pending'
          )
        }))
      },

      // Notification management actions
      markNotificationSeen: (id) => {
        set((state) => {
          const newSeenNotifications = new Set(state.seenNotifications)
          newSeenNotifications.add(id)
          return { 
            seenNotifications: newSeenNotifications,
            pendingInvitations: state.pendingInvitations.map(inv => 
              inv.id === id ? { ...inv, seen: true } : inv
            )
          }
        })
      },

      markNotificationDismissed: (id) => {
        set((state) => {
          const newDismissedNotifications = new Set(state.dismissedNotifications)
          newDismissedNotifications.add(id)
          return { 
            dismissedNotifications: newDismissedNotifications,
            pendingInvitations: state.pendingInvitations.map(inv => 
              inv.id === id ? { ...inv, dismissed: true } : inv
            )
          }
        })
      },

      isNotificationSeen: (id) => {
        const state = get()
        return state.seenNotifications.has(id)
      },

      isNotificationDismissed: (id) => {
        const state = get()
        return state.dismissedNotifications.has(id)
      },

      getUnseenInvitations: () => {
        const state = get()
        return state.pendingInvitations.filter(inv => 
          inv.status === 'pending' && 
          !state.seenNotifications.has(inv.id) && 
          !state.dismissedNotifications.has(inv.id)
        )
      },

      clearSeenNotifications: () => {
        set({ 
          seenNotifications: new Set(),
          dismissedNotifications: new Set()
        })
      },
      
      setRoomCallActive: (roomId, active) => {
        set((state) => {
          const newActiveCallRooms = new Set(state.activeCallRooms)
          if (active) {
            newActiveCallRooms.add(roomId)
          } else {
            newActiveCallRooms.delete(roomId)
          }
          return { activeCallRooms: newActiveCallRooms }
        })
      },
      
      setRoomBlinking: (roomId, blinking) => {
        set((state) => {
          const newBlinkingRooms = new Set(state.blinkingRooms)
          if (blinking) {
            newBlinkingRooms.add(roomId)
          } else {
            newBlinkingRooms.delete(roomId)
          }
          return { blinkingRooms: newBlinkingRooms }
        })
      },
      
      clearAllBlinking: () => {
        set({ blinkingRooms: new Set() })
      },
      
      getRoomUserCount: (roomId) => {
        const state = get()
        return (state.roomPresence[roomId] || []).length
      },
      
      isRoomActive: (roomId) => {
        const state = get()
        const presence = state.roomPresence[roomId] || []
        return presence.length > 0
      },
      
      hasActiveCall: (roomId) => {
        const state = get()
        return state.activeCallRooms.has(roomId)
      },
      
      getPendingInvitationsForRoom: (roomId) => {
        const state = get()
        return state.pendingInvitations.filter(inv => 
          inv.roomId === roomId && inv.status === 'pending'
        )
      },
      
      // Active call management
      startCall: (roomId, participants) => {
        try {
          set((state) => {
            // Check if call already exists to prevent duplicates
            const existingCall = state.activeCalls[roomId]
            if (existingCall) {
              return state // Call already exists, don't create duplicate
            }
            
            return {
              activeCalls: {
                ...state.activeCalls,
                [roomId]: {
                  roomId,
                  startedAt: Date.now(),
                  participants: [...participants], // Create new array
                  isMinimized: false,
                  shareableLink: undefined
                }
              },
              currentCallRoomId: roomId
            }
          })
        } catch (error) {
          console.error('Error starting call:', error)
        }
      },
      
      endCall: (roomId) => {
        set((state) => {
          const newActiveCalls = { ...state.activeCalls }
          delete newActiveCalls[roomId]
          
          return {
            activeCalls: newActiveCalls,
            currentCallRoomId: state.currentCallRoomId === roomId ? null : state.currentCallRoomId
          }
        })
      },
      
      updateCallParticipants: (roomId, participants) => {
        try {
          set((state) => {
            const call = state.activeCalls[roomId]
            if (!call) return state
            
            // Check if participants actually changed to prevent unnecessary updates
            const currentParticipants = call.participants || []
            if (JSON.stringify(currentParticipants.sort()) === JSON.stringify(participants.sort())) {
              return state // No change, return same state
            }
            
            return {
              activeCalls: {
                ...state.activeCalls,
                [roomId]: {
                  ...call,
                  participants: [...participants] // Create new array to ensure immutability
                }
              }
            }
          })
        } catch (error) {
          console.error('Error updating call participants:', error)
        }
      },
      
      setCallMinimized: (roomId, minimized) => {
        set((state) => {
          const call = state.activeCalls[roomId]
          if (!call) return state
          
          return {
            activeCalls: {
              ...state.activeCalls,
              [roomId]: {
                ...call,
                isMinimized: minimized
              }
            }
          }
        })
      },
      
      setCurrentCall: (roomId) => {
        set({ currentCallRoomId: roomId })
      },
      
      generateShareableLink: (roomId) => {
        // Build URL that respects BASE_URL (e.g., GitHub Pages subpath)
        const { buildJoinCallUrl } = require('../services/url') as typeof import('../services/url')
        const inviteUrl = buildJoinCallUrl(roomId)
        
        set((state) => {
          const call = state.activeCalls[roomId]
          if (!call) return state
          
          return {
            activeCalls: {
              ...state.activeCalls,
              [roomId]: {
                ...call,
                shareableLink: inviteUrl
              }
            }
          }
        })
        
  return inviteUrl
      },
      
      getCurrentCall: () => {
        const state = get()
        if (!state.currentCallRoomId) return null
        return state.activeCalls[state.currentCallRoomId] || null
      }
    }),
    {
      name: 'presence-store',
      // Don't persist Sets and real-time data - custom serialization
      storage: {
        getItem: (name) => {
          const item = localStorage.getItem(name)
          if (!item) return null
          return JSON.parse(item)
        },
        setItem: (name, value) => {
          // Don't persist Sets and real-time presence data
          const stateToSave = {
            ...value.state,
            roomPresence: {},
            myPresence: {},
            pendingInvitations: [],
            seenNotifications: [],
            dismissedNotifications: [],
            activeCallRooms: [],
            blinkingRooms: [],
          }
          localStorage.setItem(name, JSON.stringify({ state: stateToSave, version: value.version }))
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
      merge: (persistedState: any, currentState: State & Actions) => {
        // Ensure Sets are properly initialized when rehydrating
        return {
          ...persistedState,
          seenNotifications: new Set(Array.isArray(persistedState?.seenNotifications) ? persistedState.seenNotifications : []),
          dismissedNotifications: new Set(Array.isArray(persistedState?.dismissedNotifications) ? persistedState.dismissedNotifications : []),
          activeCallRooms: new Set(Array.isArray(persistedState?.activeCallRooms) ? persistedState.activeCallRooms : []),
          blinkingRooms: new Set(Array.isArray(persistedState?.blinkingRooms) ? persistedState.blinkingRooms : []),
          // Reset real-time data
          roomPresence: {},
          myPresence: {},
          pendingInvitations: [],
        }
      },
    }
  )
)

// Helper function to create call invitation ID
export const createCallInvitationId = () => 
  `call-${Date.now()}-${Math.random().toString(36).slice(2)}`

// Helper function to clean up old presence data
export const cleanupOldPresence = () => {
  const store = usePresenceStore.getState()
  const now = Date.now()
  const PRESENCE_TIMEOUT = 30000 // 30 seconds
  
  Object.keys(store.roomPresence).forEach(roomId => {
    const presence = store.roomPresence[roomId] || []
    const activePresence = presence.filter(p => 
      now - p.lastHeartbeat < PRESENCE_TIMEOUT
    )
    
    if (activePresence.length !== presence.length) {
      store.setRoomPresence(roomId, activePresence)
    }
  })
}
