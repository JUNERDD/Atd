/**
 * Page-wide press feedback for the Apple kit's controls, set up once from the entry: iOS Safari
 * applies `:active` only while some touch listener exists, so pressed states need one.
 */
export function initPressFeedback(): void {
  document.addEventListener('touchstart', () => {}, { passive: true });
}
