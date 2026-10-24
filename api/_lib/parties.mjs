// Which "selling party" sells which products.
// A product belongs to a party when its NAME contains any of the words (capital/small letters do not matter).
// To add another party: copy the block, change the name and the words. To stop printing: delete the block.
export const PARTY_RULES = [
  { party: "BM TRADERS", words: ["ecodrive", "eco drive", "eco-drive"] },
];

export function partyOf(item) {
  const name = String((item && item.name) || "").toLowerCase();
  for (const rule of PARTY_RULES) {
    if (rule.words.some((w) => name.includes(w.toLowerCase()))) return rule.party;
  }
  return null;
}
