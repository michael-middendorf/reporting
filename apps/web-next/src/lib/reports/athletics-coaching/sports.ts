/** Canonical athletics sports for the coaching dashboard. */

export type SportGender = "M" | "W" | "mixed";

export type SportDef = {
  key: string;
  label: string;
  gender?: SportGender;
  slateNames: string[];
  givingSlug?: string;
  virtuousProjectCode: string | null;
  /** Extra Virtuous funds that roll into this coaching sport. */
  virtuousProjectCodes?: readonly string[];
};

/**
 * Stable slugs. Giving form slugs where they exist. Golf has no giving page.
 * Marching Band is not a coaching-athletics sport.
 * virtuousProjectCode is the live Virtuous GET /api/Project/Code value.
 * Slate stores Cross Country, Track and Field, and Cross Country/Track as one
 * program (hub key xc-track). Funds 6578MXC, 6580WXC, and 6683Track all roll in.
 * Women's Golf has no project. Do not assign 6117AthGEN or 6644 to any sport.
 */
export const SPORTS: SportDef[] = [
  {
    key: "xc-track",
    label: "XC/Track and Field",
    gender: "mixed",
    slateNames: [
      "Cross Country",
      "Cross Country/Track",
      "XC",
      "Cross Country-Men",
      "M Cross Country",
      "Men's Cross Country",
      "Mens Cross Country",
      "MXC",
      "Cross Country-Women",
      "W Cross Country",
      "Women's Cross Country",
      "Womens Cross Country",
      "WXC",
      "Track and Field",
      "Track & Field",
      "Track",
      "Track-and-Field",
    ],
    givingSlug: "cross-country",
    virtuousProjectCodes: ["6578MXC", "6580WXC", "6683Track"],
    virtuousProjectCode: null,
  },
  {
    key: "dance-team",
    label: "Competitive Dance",
    gender: "W",
    slateNames: ["Competitive Dance", "Dance", "Dance Team"],
    givingSlug: "dance-team",
    virtuousProjectCode: "6596Dance",
  },
  {
    key: "football",
    label: "Football",
    gender: "M",
    slateNames: ["Football"],
    givingSlug: "football",
    virtuousProjectCode: "6552FB",
  },
  {
    key: "mens-baseball",
    label: "Baseball",
    gender: "M",
    slateNames: ["Baseball", "Baseball-Men", "M Baseball", "Men's Baseball"],
    givingSlug: "mens-baseball",
    virtuousProjectCode: "6543MBase",
  },
  {
    key: "mens-basketball",
    label: "Men's Basketball",
    gender: "M",
    slateNames: ["Basketball-Men", "M Basketball", "Men's Basketball", "Mens Basketball"],
    givingSlug: "mens-basketball",
    virtuousProjectCode: "6530MBB",
  },
  {
    key: "mens-golf",
    label: "Men's Golf",
    gender: "M",
    slateNames: ["Golf-Men", "M Golf", "Men's Golf", "Mens Golf"],
    virtuousProjectCode: "6622MGolf",
  },
  {
    key: "mens-soccer",
    label: "Men's Soccer",
    gender: "M",
    slateNames: ["Soccer-Men", "M Soccer", "Men's Soccer", "Mens Soccer"],
    givingSlug: "mens-soccer",
    virtuousProjectCode: "6569MSoc",
  },
  {
    key: "rugby",
    label: "Rugby",
    gender: "mixed",
    slateNames: ["Rugby", "Rugby-Men", "Rugby-Women", "M Rugby", "W Rugby", "Men's Rugby", "Women's Rugby"],
    givingSlug: "rugby",
    // Men's Rugby project. Catalog sport is mixed; this is not a women's project.
    virtuousProjectCode: "6540MRugby",
  },
  {
    key: "swim-team",
    label: "Swimming",
    gender: "mixed",
    slateNames: ["Swimming", "Swim Team", "M Swimming", "W Swimming", "Swimming-Men", "Swimming-Women", "Men's Swimming", "Women's Swimming"],
    givingSlug: "swim-team",
    virtuousProjectCode: "6201Swim",
  },
  {
    key: "tennis",
    label: "Tennis",
    gender: "mixed",
    slateNames: ["Tennis", "M Tennis", "W Tennis", "Tennis-Men", "Tennis-Women", "Men's Tennis", "Women's Tennis"],
    givingSlug: "tennis",
    virtuousProjectCode: "6563Tennis",
  },
  {
    key: "ultimate-frisbee",
    label: "Ultimate Frisbee",
    gender: "mixed",
    slateNames: ["Ultimate Frisbee", "Frisbee", "Ultimate"],
    givingSlug: "ultimate-frisbee",
    // Men's Ultimate (6251FrisM). Catalog sport is mixed; this is not a women's project.
    virtuousProjectCode: "6251FrisM",
  },
  {
    key: "womens-basketball",
    label: "Women's Basketball",
    gender: "W",
    slateNames: ["Basketball-Women", "W Basketball", "Women's Basketball", "Womens Basketball"],
    givingSlug: "womens-basketball",
    virtuousProjectCode: "6514WBB",
  },
  {
    key: "womens-golf",
    label: "Women's Golf",
    gender: "W",
    slateNames: ["Golf-Women", "W Golf", "Women's Golf", "Womens Golf"],
    // No Virtuous project found.
    virtuousProjectCode: null,
  },
  {
    key: "womens-lacrosse",
    label: "Women's Lacrosse",
    gender: "W",
    slateNames: ["Lacrosse", "Lacrosse-Women", "W Lacrosse", "Women's Lacrosse", "Womens Lacrosse"],
    givingSlug: "womens-lacrosse",
    virtuousProjectCode: "6654WLACR",
  },
  {
    key: "womens-soccer",
    label: "Women's Soccer",
    gender: "W",
    slateNames: ["Soccer-Women", "W Soccer", "Women's Soccer", "Womens Soccer"],
    givingSlug: "womens-soccer",
    virtuousProjectCode: "6572WSoc",
  },
  {
    key: "womens-softball",
    label: "Softball",
    gender: "W",
    slateNames: ["Softball", "Softball-Women", "W Softball", "Women's Softball"],
    givingSlug: "womens-softball",
    virtuousProjectCode: "6557WSoft",
  },
  {
    key: "womens-volleyball",
    label: "Women's Volleyball",
    gender: "W",
    slateNames: ["Volleyball", "Volleyball-Women", "W Volleyball", "Women's Volleyball"],
    givingSlug: "womens-volleyball",
    virtuousProjectCode: "6573WVB",
  },
];

export const sportByKey: Readonly<Record<string, SportDef>> = Object.fromEntries(
  SPORTS.map((sport) => [sport.key, sport]),
);

const EXCLUDED = new Set([
  "marching band",
  "band",
  "color guard",
  "pickleball",
  "ireland",
  "cheer",
  "cheerleading",
]);

/** Extra folds for Slate currentsport / PersonSport and informal names. */
const EXTRA_ALIASES: Record<string, string> = {
  baseball: "mens-baseball",
  "m baseball": "mens-baseball",
  "mens baseball": "mens-baseball",
  "baseball men": "mens-baseball",
  "m basketball": "mens-basketball",
  "mens basketball": "mens-basketball",
  "basketball men": "mens-basketball",
  "m golf": "mens-golf",
  "mens golf": "mens-golf",
  "golf men": "mens-golf",
  "m soccer": "mens-soccer",
  "mens soccer": "mens-soccer",
  "soccer men": "mens-soccer",
  "w basketball": "womens-basketball",
  "womens basketball": "womens-basketball",
  "basketball women": "womens-basketball",
  "w golf": "womens-golf",
  "womens golf": "womens-golf",
  "golf women": "womens-golf",
  "w soccer": "womens-soccer",
  "womens soccer": "womens-soccer",
  "soccer women": "womens-soccer",
  "w lacrosse": "womens-lacrosse",
  "womens lacrosse": "womens-lacrosse",
  lacrosse: "womens-lacrosse",
  softball: "womens-softball",
  volleyball: "womens-volleyball",
  "w volleyball": "womens-volleyball",
  dance: "dance-team",
  "dance team": "dance-team",
  "competitive dance": "dance-team",
  "cross country": "xc-track",
  "cross country track": "xc-track",
  xc: "xc-track",
  "xc track": "xc-track",
  "m cross country": "xc-track",
  "mens cross country": "xc-track",
  "cross country men": "xc-track",
  mxc: "xc-track",
  "mens xc": "xc-track",
  "m xc": "xc-track",
  "w cross country": "xc-track",
  "womens cross country": "xc-track",
  "cross country women": "xc-track",
  wxc: "xc-track",
  "womens xc": "xc-track",
  "w xc": "xc-track",
  track: "xc-track",
  "track field": "xc-track",
  "track and field": "xc-track",
  "track-and-field": "xc-track",
  "cross-country": "xc-track",
  "mens-cross-country": "xc-track",
  "womens-cross-country": "xc-track",
  swim: "swim-team",
  swimming: "swim-team",
  "swim team": "swim-team",
  "m swimming": "swim-team",
  "w swimming": "swim-team",
  "swimming men": "swim-team",
  "swimming women": "swim-team",
  tennis: "tennis",
  rugby: "rugby",
  "m rugby": "rugby",
  "w rugby": "rugby",
  "rugby men": "rugby",
  "rugby women": "rugby",
  frisbee: "ultimate-frisbee",
  ultimate: "ultimate-frisbee",
  "ultimate frisbee": "ultimate-frisbee",
};

function fold(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[_/,-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOOKUP: Record<string, string> = { ...EXTRA_ALIASES };

for (const sport of SPORTS) {
  LOOKUP[fold(sport.key)] = sport.key;
  if (sport.givingSlug) LOOKUP[fold(sport.givingSlug)] = sport.key;
  for (const name of sport.slateNames) LOOKUP[fold(name)] = sport.key;
}

/** Old coaching URLs and coach maps fold into XC/Track and Field. */
const LEGACY_SPORT_KEYS: Record<string, string> = {
  "cross-country": "xc-track",
  "mens-cross-country": "xc-track",
  "womens-cross-country": "xc-track",
  "track-and-field": "xc-track",
};

/** Catalog key for a sport slug, including retired XC/Track keys. */
export function canonicalSportKey(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (sportByKey[raw]) return raw;
  const legacy = LEGACY_SPORT_KEYS[raw];
  if (legacy && sportByKey[legacy]) return legacy;
  return resolveSportKey(raw);
}

export function isSportKey(value: string): boolean {
  return Boolean(canonicalSportKey(value));
}

function genderToken(value: string): "M" | "F" | null {
  const folded = value.trim().toLowerCase();
  if (folded === "m" || folded === "male" || folded === "man" || folded === "men") return "M";
  if (folded === "f" || folded === "female" || folded === "w" || folded === "woman" || folded === "women") return "F";
  return null;
}

/**
 * Slate leaves these names ungendered. Gender picks men's or women's.
 * Cross Country/Track is one mixed program and is not in this list.
 */
const GENDERED_SPORTS: Record<string, { M: string; F: string }> = {
  basketball: { M: "mens-basketball", F: "womens-basketball" },
  soccer: { M: "mens-soccer", F: "womens-soccer" },
  golf: { M: "mens-golf", F: "womens-golf" },
};

/** Map Slate / giving / informal sport text to a catalog key. Ambiguous ungendered names return null. */
export function resolveSportKey(raw: string): string | null {
  const folded = fold(raw);
  if (!folded) return null;
  if (EXCLUDED.has(folded) || folded.includes("pickleball") || folded.includes("cheer")) return null;
  if (GENDERED_SPORTS[folded]) return null;
  const legacy = LEGACY_SPORT_KEYS[raw.trim()] || LEGACY_SPORT_KEYS[folded.replace(/ /g, "-")];
  if (legacy && sportByKey[legacy]) return legacy;
  const key = LOOKUP[folded];
  return key && sportByKey[key] ? key : null;
}

/**
 * Resolve a team key. Gender is used only for Basketball, Soccer, and Golf.
 * A missing gender leaves those rows unmatched.
 */
export function resolveGenderedSportKey(raw: string, gender: string): string | null {
  const direct = resolveSportKey(raw);
  if (direct) return direct;
  const pair = GENDERED_SPORTS[fold(raw)];
  if (!pair) return null;
  const token = genderToken(gender);
  if (!token) return null;
  return pair[token];
}

/** Coach and overview assignments. An ungendered name grants the teams the gender list allows. */
export function ambiguousSportKeys(raw: string, genders?: readonly string[]): string[] | null {
  const pair = GENDERED_SPORTS[fold(raw)];
  if (!pair) return null;
  const genderSet = new Set((genders || []).map((item) => item.trim().toUpperCase()));
  const men = !genderSet.size || genderSet.has("M");
  const women = !genderSet.size || genderSet.has("F") || genderSet.has("W");
  const keys: string[] = [];
  if (men) keys.push(pair.M);
  if (women) keys.push(pair.F);
  return keys;
}
