import { selectionCodeAriaLabel, ticketOutcomeLabel } from './race-viewer-results.js';

describe('race result ticket accessibility', () => {
  it('announces every horse number once for all selection sizes', () => {
    expect(selectionCodeAriaLabel('1')).toBe('1番');
    expect(selectionCodeAriaLabel('1-2')).toBe('1番、2番');
    expect(selectionCodeAriaLabel('1-2-3')).toBe('1番、2番、3番');
  });
});

describe('ticketOutcomeLabel', () => {
  it('does not call an unsettled ticket a loss', () => {
    // Settlement lands after the results screen appears, so a winning ticket is
    // still `open` with a zero payout when the screen first renders.
    expect(ticketOutcomeLabel({ status: 'open', payout: '0' })).toBe('精算中');
  });

  it('shows the payout once the ticket is settled', () => {
    expect(ticketOutcomeLabel({ status: 'won', payout: '2500' })).toBe('2,500 CP');
    expect(ticketOutcomeLabel({ status: 'lost', payout: '0' })).toBe('はずれ');
    expect(ticketOutcomeLabel({ status: 'refunded', payout: '0' })).toBe('返還');
  });
});
