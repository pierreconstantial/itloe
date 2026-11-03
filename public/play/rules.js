// "How to play" content: one short line per rule, each illustrated by a piece.

/** @type {{ piece: import('../../shared/pieces.js').PieceId, text: string }[]} */
export const RULES = [
  { piece: 't_down', text: 'Drag a piece onto your board. No rotating!' },
  { piece: 'h4', text: 'Fill a whole row or column to clear it.' },
  { piece: 'sq2', text: 'Clear several lines at once, or clear on every move, for combo points.' },
  { piece: 'c_nw', text: 'Everyone gets the same pieces, in the same order.' },
  { piece: 'dot', text: "No room for any piece you hold? You're out. Top score wins!" },
];
