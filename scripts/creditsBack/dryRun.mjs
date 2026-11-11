// READ-ONLY dry run for the "credits_back_nov2026" campaign.
// Issues only find / aggregate queries — never writes, deletes or sends.
// Usage (from ReplyLingo_Backend/): node scripts/creditsBack/dryRun.mjs
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { Expo } from "expo-server-sdk";
import Usage from "../../src/models/Usage.js";
import DeviceUsage from "../../src/models/DeviceUsage.js";
import User from "../../src/models/User.js";
import Event from "../../src/models/Event.js";

const APP_LOCALES = ["ar","bn","de","en","es","fa","fr","hi","id","it","ja","ko","nl","pa","pl","pt","ru","tr","ur","zh"];
const tally = (rows, key) => rows.reduce((m, r) => ((m[key(r)] = (m[key(r)] || 0) + 1), m), {});

await mongoose.connect(process.env.MONGODB_URI);
const now = new Date();

// 1. Everyone who has used all free credits.
const exhausted = await Usage.find({ $expr: { $gte: ["$usageCredits", "$freeLimit"] } })
  .select("uid usageCredits freeLimit").lean();
const exhaustedUids = exhausted.map((u) => u.uid);
const users = await User.find({ uid: { $in: exhaustedUids } })
  .select("uid guest premium premiumPeriodType premiumExpiresAt pushToken pushPlatform lastActiveAt").lean();
const userByUid = new Map(users.map((u) => [u.uid, u]));

// 2. Exclusions: premium, active trial, or any not-yet-expired entitlement.
const excluded = { premium: [], trial: [], activeEntitlement: [], noUserDoc: [] };
const eligible = [];
for (const u of exhausted) {
  const user = userByUid.get(u.uid);
  if (!user) { excluded.noUserDoc.push(u.uid); continue; }
  if (user.premium) {
    (user.premiumPeriodType === "TRIAL" ? excluded.trial : excluded.premium).push(u.uid);
  } else if (user.premiumPeriodType === "TRIAL" && user.premiumExpiresAt && user.premiumExpiresAt > now) {
    excluded.trial.push(u.uid);
  } else if (user.premiumExpiresAt && user.premiumExpiresAt > now) {
    excluded.activeEntitlement.push(u.uid);
  } else {
    eligible.push(user);
  }
}
const eligibleSet = new Set(eligible.map((u) => u.uid));

// 3. Device docs touching any eligible uid: delete only if ALL uids eligible.
const devices = await DeviceUsage.find({ uids: { $in: [...eligibleSet] } }).lean();
const deletable = devices.filter((d) => d.uids.length > 0 && d.uids.every((x) => eligibleSet.has(x)));
const kept = devices.filter((d) => !deletable.includes(d));
const keptBlocking = kept.filter((d) => d.usageCredits >= 3);
const blockedUids = new Set(keptBlocking.flatMap((d) => d.uids.filter((x) => eligibleSet.has(x))));

// 5. Push tokens + language (language is NOT stored on User; best proxy is
// the latest first-party language_changed(app_language) event per uid).
const withToken = eligible.filter((u) => u.pushToken && Expo.isExpoPushToken(u.pushToken));
const tokenUids = withToken.map((u) => u.uid);
const langRows = await Event.aggregate([
  { $match: { eventName: "language_changed", "params.type": "app_language", uid: { $in: tokenUids } } },
  { $sort: { createdAt: 1 } },
  { $group: { _id: "$uid", language: { $last: "$params.language" } } },
]);
const langByUid = new Map(langRows.map((r) => [r._id, r.language]));
const langOf = (u) => {
  const l = langByUid.get(u.uid);
  return APP_LOCALES.includes(l) ? l : "unknown(->en)";
};

const out = {
  ranAt: now.toISOString(),
  exhaustedUsageDocs: exhausted.length,
  eligible: eligible.length,
  eligibleGuests: eligible.filter((u) => u.guest).length,
  excluded: Object.fromEntries(Object.entries(excluded).map(([k, v]) => [k, v.length])),
  deviceDocs: {
    touchingEligible: devices.length,
    willDelete: deletable.length,
    keptSharedWithNonEligible: kept.length,
    keptButStillBlockingEligibleUsers: keptBlocking.length,
    eligibleUsersStillBlockedByKeptDevice: blockedUids.size,
  },
  pushReachable: withToken.length,
  eligibleWithoutValidToken: eligible.length - withToken.length,
  pushByPlatform: tally(withToken, (u) => u.pushPlatform || "unknown"),
  pushByLanguage: tally(withToken, langOf),
};
console.log(JSON.stringify(out, null, 2));
await mongoose.disconnect();
