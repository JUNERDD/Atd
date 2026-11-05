import { createRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScrollArea } from '@atd/ui/components/scroll-area';

describe('scroll viewport forwarded ref lifetime', () => {
  it('runs callback cleanup on replacement and unmount without calling a cleaned ref with null', () => {
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    const first = vi.fn((_node: HTMLDivElement | null) => firstCleanup);
    const second = vi.fn((_node: HTMLDivElement | null) => secondCleanup);
    const mounted = render(<ScrollArea viewportRef={first}>Content</ScrollArea>);
    const viewport = mounted.container.querySelector('[data-slot="scroll-area-viewport"]');
    expect(first).toHaveBeenCalledExactlyOnceWith(viewport);
    expect(firstCleanup).not.toHaveBeenCalled();
    mounted.rerender(<ScrollArea viewportRef={second}>Content</ScrollArea>);
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledExactlyOnceWith(viewport);
    mounted.unmount();
    expect(secondCleanup).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('clears object refs when replaced and unmounted', () => {
    const first = createRef<HTMLDivElement>();
    const second = createRef<HTMLDivElement>();
    const mounted = render(<ScrollArea viewportRef={first}>Content</ScrollArea>);
    const viewport = first.current;
    expect(viewport).toBeInstanceOf(HTMLDivElement);
    mounted.rerender(<ScrollArea viewportRef={second}>Content</ScrollArea>);
    expect(first.current).toBeNull();
    expect(second.current).toBe(viewport);
    mounted.unmount();
    expect(second.current).toBeNull();
  });

  it('calls legacy callback refs with null on replacement and unmount', () => {
    const first = vi.fn((_node: HTMLDivElement | null) => {});
    const second = vi.fn((_node: HTMLDivElement | null) => {});
    const mounted = render(<ScrollArea viewportRef={first}>Content</ScrollArea>);
    const viewport = mounted.container.querySelector('[data-slot="scroll-area-viewport"]');
    mounted.rerender(<ScrollArea viewportRef={second}>Content</ScrollArea>);
    expect(first.mock.calls).toEqual([[viewport], [null]]);
    mounted.unmount();
    expect(second.mock.calls).toEqual([[viewport], [null]]);
  });
});
