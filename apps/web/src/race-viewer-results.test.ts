import { selectionCodeAriaLabel } from './race-viewer-results.js';

describe('race result ticket accessibility', () => {
  it('announces every horse number once for all selection sizes', () => {
    expect(selectionCodeAriaLabel('1')).toBe('1番');
    expect(selectionCodeAriaLabel('1-2')).toBe('1番、2番');
    expect(selectionCodeAriaLabel('1-2-3')).toBe('1番、2番、3番');
  });
});
