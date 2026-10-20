import type { SettingsSearchEntry } from './settings-search-index';

/**
 * The settings inside Computer use, in page order (`computer-settings.tsx` and its status
 * card mark the anchors); the section itself is a search entry of its own.
 */
export const computerSearchEntries: readonly SettingsSearchEntry[] = [
  {
    id: 'computer-vision',
    section: 'computer',
    anchor: 'computer-vision',
    label: 'computer.vision.model',
    description: 'computer.vision.description',
    keywords: 'search.keywords.computerVision',
  },
  {
    id: 'computer-engines',
    section: 'computer',
    anchor: 'computer-engines',
    label: 'computer.groups.engines',
    description: 'computer.engines.searchDescription',
    keywords: 'search.keywords.computerEngines',
  },
  {
    id: 'computer-capture',
    section: 'computer',
    anchor: 'computer-capture',
    label: 'computer.capture.prepare',
    description: 'computer.capture.searchDescription',
    keywords: 'search.keywords.computerCapture',
  },
  {
    id: 'computer-pointer',
    section: 'computer',
    anchor: 'computer-pointer',
    label: 'computer.pointer.title',
    description: 'computer.pointer.description',
    keywords: 'search.keywords.computerPointer',
  },
  {
    id: 'computer-targets',
    section: 'computer',
    anchor: 'computer-targets',
    label: 'computer.targets.title',
    description: 'computer.targets.searchDescription',
    keywords: 'search.keywords.computerTargets',
  },
  {
    id: 'computer-add-browser',
    section: 'computer',
    anchor: 'computer-add',
    label: 'computer.targets.addBrowser',
    description: 'computer.browser.description',
    keywords: 'search.keywords.computerBrowser',
  },
  {
    id: 'computer-add-application',
    section: 'computer',
    anchor: 'computer-add',
    label: 'computer.targets.addApplication',
    description: 'computer.application.description',
    keywords: 'search.keywords.computerApplication',
  },
  {
    id: 'computer-typing',
    section: 'computer',
    anchor: 'computer-typing',
    label: 'computer.typing.title',
    description: 'computer.typing.description',
    keywords: 'search.keywords.computerTyping',
  },
  {
    id: 'computer-typing-animation',
    section: 'computer',
    anchor: 'computer-typing-animation',
    label: 'computer.typingAnimation.title',
    description: 'computer.typingAnimation.description',
    keywords: 'search.keywords.computerTyping',
  },
  {
    id: 'computer-stop-all',
    section: 'computer',
    anchor: 'computer-stop-all',
    label: 'computer.stopAll.action',
    description: 'computer.stopAll.description',
    keywords: 'search.keywords.computerStop',
  },
];
