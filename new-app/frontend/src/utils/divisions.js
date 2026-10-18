/**
 * Division presentation helpers.
 *
 * The three business divisions (plus AMC, which behaves as a segment
 * alongside them) each have a fixed accent defined in styles/tokens.css.
 * Keeping the mapping here means every screen tints a division the same
 * way without importing anything from a component module.
 *
 * Presentation only — entitlement to a division is decided by the server
 * (see backend subscriptionService.assertDivisionEntitled).
 */
export const DIVISION_CLASS = {
  HVAC: 'div-hvac',
  Solar: 'div-solar',
  MEP: 'div-mep',
  AMC: 'div-amc',
};

/** Class list for a division chip, falling back to a neutral chip. */
export function divisionClass(division) {
  return `div-chip ${DIVISION_CLASS[division] || 'b-gry'}`;
}
