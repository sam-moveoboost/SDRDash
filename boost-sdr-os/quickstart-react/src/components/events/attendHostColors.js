// Matches the "Attend or Host" status column's actual label colors on the
// live Events board (color_mm5g1ye5) — verified against the board schema,
// not guessed, since these are easy to get subtly wrong. Shared between
// EventCalendar and EventInsights so the two views can't drift apart.
export const ATTEND_HOST_COLORS = {
  'Rec: Attend':        '#9d99b9',
  'Rec: Host':          '#fdab3d',
  'Decided: Attending': '#00c875',
  'Decided: Hosting':   '#037f4c',
  'Not Going':          '#bb3354',
};
