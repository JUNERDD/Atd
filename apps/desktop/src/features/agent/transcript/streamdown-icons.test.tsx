import { render, screen } from '@testing-library/react';
import { Streamdown } from 'streamdown';
import { describe, expect, it } from 'vitest';
import { STREAMDOWN_ICONS } from './streamdown-icons';

/** Streamdown names each slot after a Lucide glyph: `Maximize2Icon` draws `lucide-maximize-2`. */
function lucideClass(slot: string) {
  const name = slot.replace(/Icon$/, '').replace(/(?<=[a-z])(?=[A-Z0-9])/g, '-');
  return `lucide-${name.toLowerCase()}`;
}

describe('Streamdown icons', () => {
  it.each(Object.entries(STREAMDOWN_ICONS))('draws the Lucide glyph %s names', (slot, Icon) => {
    const { container } = render(<Icon size={14} className="control-icon" />);
    const glyph = container.querySelector('svg');
    expect(glyph).toHaveClass('lucide', lucideClass(slot), 'control-icon');
    expect(glyph).toHaveAttribute('width', '14');
    expect(glyph).toHaveAttribute('height', '14');
  });

  it("keeps Lucide's default size when Streamdown sets none", () => {
    for (const Icon of Object.values(STREAMDOWN_ICONS)) {
      const { container, unmount } = render(
        <>
          <Icon />
          <Icon size={undefined} />
        </>,
      );
      for (const glyph of container.querySelectorAll('svg')) {
        expect(glyph).toHaveAttribute('width', '24');
        expect(glyph).toHaveAttribute('height', '24');
      }
      unmount();
    }
  });

  it("draws Streamdown's own controls with the app's glyphs at the size it asks for", async () => {
    // Table controls are the ones jsdom can draw; a diagram's controls need a layout engine.
    render(
      <Streamdown icons={STREAMDOWN_ICONS} controls={{ table: true }} mode="static">
        {'| Step | State |\n| --- | --- |\n| Plan | Done |'}
      </Streamdown>,
    );
    const glyph = (await screen.findByRole('button', { name: 'Copy table' })).querySelector('svg');
    expect(glyph).toHaveClass('lucide', 'lucide-copy');
    expect(glyph).toHaveAttribute('width', '14');
  });
});
