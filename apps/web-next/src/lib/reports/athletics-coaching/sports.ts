/** Canonical athletics sports for the coaching dashboard. */

export type SportGender = "M" | "W" | "mixed";

export type SportDef = {
  key: string;
  label: string;
  gender?: SportGender;
  slateNames: string[];
  givingSlug?: string;
  virtuousProjectCode: string | null;
};

/**
 * Stable slugs. Giving form slugs where they exist. Golf has no giving page.
 * Marching Band is not a coaching-athletics sport.
 * virtuousProjectCode is the live Virtuous GET /api/Project/Code value.
 * Cross Country stays null (two funds 6578MXC and 6580WXC). Women's Golf has no project.
 * Do not assign 6117AthGEN or 6644 to any sport.
 */
export const SPORTS: SportDef[] = [
  {
    key: "cheerleading",
    label: "Cheerleading",
    gender: "mixed",
    slateNames: ["Cheerleading", "Cheer"],
    givingSlug: "cheerleading",
    virtuousProjectCode: "6625Cheer",
  },
  {
    key: "cross-country",
    label: "Cross Country",
    gender: "mixed",
    slateNames: ["Cross Country", "Cross Country/Track", "XC"],
    givingSlug: "cross-country",
    // Two funds 6578MXC and 6580WXC; do not pick one.
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
    key: "track-and-field",
    label: "Track and Field",
    gender: "mixed",
    slateNames: ["Track and Field", "Track & Field", "Track", "Track-and-Field"],
    givingSlug: "track-and-field",
    virtuousProjectCode: "6683Track",
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

const EXCLUDED = new Set(["marching band", "band", "color guard", "pickleball", "ireland"]);

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
  cheer: "cheerleading",
  dance: "dance-team",
  "dance team": "dance-team",
  "competitive dance": "dance-team",
  xc: "cross-country",
  "cross country": "cross-country",
  "cross country track": "cross-country",
  track: "track-and-field",
  "track field": "track-and-field",
  "track and field": "track-and-field",
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

export function isSportKey(value: string): boolean {
  return Boolean(sportByKey[value]);
}

/** Map Slate / giving / informal sport text to a catalog key. Ambiguous ungendered basketball/soccer/golf return null. */
export function resolveSportKey(raw: string): string | null {
  const folded = fold(raw);
  if (!folded) return null;
  if (EXCLUDED.has(folded) || folded.includes("pickleball")) return null;
  if (folded === "basketball" || folded === "soccer" || folded === "golf") return null;
  const key = LOOKUP[folded];
  return key && sportByKey[key] ? key : null;
}
