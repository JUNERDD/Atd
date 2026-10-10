import type { Lang } from '../../copy.ts';

/**
 * The Mac's own chrome per language, as macOS names it in that language: Finder and the menus the
 * film's apps show, Finder's sidebar, and the menu bar clock's resting time. File and folder names
 * are content, not chrome, and stay as the scenes give them.
 */
export const MAC_CHROME = {
  en: {
    finder: 'Finder',
    menus: {
      finder: ['File', 'Edit', 'View', 'Go', 'Window', 'Help'],
      reader: ['File', 'Edit', 'View', 'History', 'Bookmarks', 'Window', 'Help'],
      app: ['File', 'Edit', 'View', 'Window', 'Help'],
    },
    sidebar: {
      favorites: 'Favorites',
      locations: 'Locations',
      icloud: 'iCloud Drive',
      places: {
        Recents: 'Recents',
        Applications: 'Applications',
        Desktop: 'Desktop',
        Documents: 'Documents',
        Downloads: 'Downloads',
      },
    },
    clock: 'Fri Oct 10  9:41',
  },
  zh: {
    finder: '访达',
    menus: {
      finder: ['文件', '编辑', '显示', '前往', '窗口', '帮助'],
      reader: ['文件', '编辑', '显示', '历史记录', '书签', '窗口', '帮助'],
      app: ['文件', '编辑', '显示', '窗口', '帮助'],
    },
    sidebar: {
      favorites: '个人收藏',
      locations: '位置',
      icloud: 'iCloud 云盘',
      places: {
        Recents: '最近使用',
        Applications: '应用程序',
        Desktop: '桌面',
        Documents: '文稿',
        Downloads: '下载',
      },
    },
    clock: '10月10日 周五  9:41',
  },
} as const satisfies Record<Lang, unknown>;

/** Finder's sidebar places, by their English names, which the scenes use as folder titles. */
export type FinderPlace = keyof (typeof MAC_CHROME)['en']['sidebar']['places'];
