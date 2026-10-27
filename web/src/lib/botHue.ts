/**
 * A bot's identity colour, derived from its name.
 *
 * One function so the avatar gradient and the conversation accent can never
 * drift apart: the avatar is the same hue the transcript uses, which is what
 * lets an unboxed assistant reply still read as coming from someone.
 *
 * Derivation, not configuration — a bot is identified by its name, so a
 * card needs no colour field and two installations agree on the same hue.
 */
export function botHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}
