import { describe, expect, it } from 'vitest';
import { fitCrumbs } from './breadcrumb';

// widths: [Library, ...ancestors, current, ellipsis]
const W = [50, 40, 224, 60, 220, 24]; // Library, books, long-slug, markdown, current, …

describe('fitCrumbs', () => {
  it('keeps every ancestor when the whole path fits', () => {
    expect(fitCrumbs(700, W)).toEqual({ kept: 3, showRoot: true });
  });
  it('folds the farthest ancestors first, keeping the nearest to the current crumb', () => {
    // 50 library + 24 ellipsis + 160 current min = 234; 100 left fits markdown (60) only
    expect(fitCrumbs(334, W)).toEqual({ kept: 1, showRoot: true });
  });
  it('keeps no ancestors when nothing fits beside Library, … and the current crumb', () => {
    expect(fitCrumbs(250, W)).toEqual({ kept: 0, showRoot: true });
  });
  it('folds Library into the menu too when Library, … and the current crumb cannot fit', () => {
    expect(fitCrumbs(150, W)).toEqual({ kept: 0, showRoot: false });
  });
  it('handles a path with no ancestors', () => {
    expect(fitCrumbs(300, [50, 120, 24])).toEqual({ kept: 0, showRoot: true });
  });
});
