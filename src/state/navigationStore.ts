import { create } from 'zustand'

export type Page = 'chatList' | 'chatWindow' | 'roomList' | 'roomWindow' | 'settings'

type NavigationState = {
  currentPage: Page
  previousPage: Page | null
  chatBackTitle: string | null // برای نمایش نام مخاطب در header
}

type NavigationActions = {
  navigateTo: (page: Page, backTitle?: string) => void
  goBack: () => void
  setChatBackTitle: (title: string | null) => void
}

export const useNavigationStore = create<NavigationState & NavigationActions>((set, get) => ({
  currentPage: 'chatList',
  previousPage: null,
  chatBackTitle: null,
  
  navigateTo: (page: Page, backTitle?: string) => {
    const { currentPage } = get()
    set({
      previousPage: currentPage,
      currentPage: page,
      chatBackTitle: backTitle || null
    })
  },
  
  goBack: () => {
    const { previousPage } = get()
    if (previousPage) {
      set({
        currentPage: previousPage,
        previousPage: null,
        chatBackTitle: null
      })
    } else {
      // اگر previous page نباشد، به صفحه اصلی (chat list) برگرد
      set({
        currentPage: 'chatList',
        previousPage: null,
        chatBackTitle: null
      })
    }
  },
  
  setChatBackTitle: (title: string | null) => {
    set({ chatBackTitle: title })
  }
}))
