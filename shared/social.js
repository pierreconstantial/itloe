export const MAX_SAY_LENGTH = 100;
export const EMOTES = ['victory', 'fart', 'annoy', 'shine'];

/** Short, printable speech for both the wire and the bubble. @param {unknown} value */
export function cleanSpeech(value) {
  if (typeof value !== 'string' || value.length > 400) return null;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text && [...text].length <= MAX_SAY_LENGTH ? text : null;
}

/** @param {unknown} value */
export function isEmote(value) {
  return typeof value === 'string' && EMOTES.includes(value);
}
