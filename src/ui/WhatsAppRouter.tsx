import { useState, useEffect } from 'react'
import { useChatStore } from '../state/chatStore'
import { useContactStore } from '../state/contactStore'
import { WhatsAppHomePage } from './WhatsAppHomePage'
import { WhatsAppChatPage } from './WhatsAppChatPage'

interface WhatsAppRouterProps {
  onSettingsOpen: () => void
  onNewChatOpen: () => void
  onQRScanOpen: () => void
}

export type WhatsAppView = 'home' | 'chat'

export interface WhatsAppRoute {
  view: WhatsAppView
  peer?: string
}

export function WhatsAppRouter({ onSettingsOpen, onNewChatOpen, onQRScanOpen }: WhatsAppRouterProps) {
  const [currentRoute, setCurrentRoute] = useState<WhatsAppRoute>({ view: 'home' })
  const conversations = useChatStore(s => s.conversations)
  const aliases = useContactStore(s => s.aliases)

  // Handle navigation
  const navigateToChat = (peer: string) => {
    setCurrentRoute({ view: 'chat', peer })
  }

  const navigateToHome = () => {
    setCurrentRoute({ view: 'home' })
  }

  // Check if peer exists when navigating to chat
  useEffect(() => {
    if (currentRoute.view === 'chat' && currentRoute.peer) {
      const hasConversation = conversations[currentRoute.peer]
      const hasAlias = aliases[currentRoute.peer]
      
      // If peer doesn't exist, go back to home
      if (!hasConversation && !hasAlias) {
        setCurrentRoute({ view: 'home' })
      }
    }
  }, [currentRoute, conversations, aliases])

  // Render current view
  switch (currentRoute.view) {
    case 'chat':
      if (!currentRoute.peer) {
        return (
          <WhatsAppHomePage
            onChatSelect={navigateToChat}
            onSettingsOpen={onSettingsOpen}
            onNewChatOpen={onNewChatOpen}
            onQRScanOpen={onQRScanOpen}
          />
        )
      }
      
      return (
        <WhatsAppChatPage
          peer={currentRoute.peer}
          onBack={navigateToHome}
          onSettingsOpen={onSettingsOpen}
        />
      )
      
    case 'home':
    default:
      return (
        <WhatsAppHomePage
          onChatSelect={navigateToChat}
          onSettingsOpen={onSettingsOpen}
          onNewChatOpen={onNewChatOpen}
          onQRScanOpen={onQRScanOpen}
        />
      )
  }
}
