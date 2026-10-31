import type { AtlasAPI } from '../../preload/index'

declare global {
  interface Window {
    atlas: AtlasAPI
  }
}

export {}
