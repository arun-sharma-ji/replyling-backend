// "Free credits back" campaign (credits_back_nov2026).
//   node scripts/creditsBack/creditsBack.mjs                 -> plan only, writes nothing
//   node scripts/creditsBack/creditsBack.mjs --apply         -> backup + delete usages/devices + register recipients
//   node scripts/creditsBack/creditsBack.mjs --send [--limit N] -> send the push (only to status=pending, once each)
import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { Expo } from "expo-server-sdk";
import Usage from "../../src/models/Usage.js";
import DeviceUsage from "../../src/models/DeviceUsage.js";
import User from "../../src/models/User.js";
import Event from "../../src/models/Event.js";
import Recipient from "../../src/models/CreditsCampaignRecipient.js";
import { MESSAGES, LOCALES } from "./messages.mjs";

const CAMPAIGN = "credits_back_nov2026";
const ANDROID_CHANNEL = "default-v2"; // must match pushNotification.service.js
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const SEND = args.includes("--send");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;

await mongoose.connect(process.env.MONGODB_URI);

// ---------- plan (fresh read every time) ----------
async function buildPlan() {
  const now = new Date();
  const exhausted = await Usage.find({ $expr: { $gte: ["$usageCredits", "$freeLimit"] } }).select("uid").lean();
  const users = await User.find({ uid: { $in: exhausted.map((u) => u.uid) } })
    .select("uid guest premium premiumPeriodType premiumExpiresAt pushToken pushPlatform appLanguage").lean();
  const byUid = new Map(users.map((u) => [u.uid, u]));

  const eligible = [];
  const excluded = { premium: 0, trial: 0, activeEntitlement: 0, noUserDoc: 0 };
  for (const { uid } of exhausted) {
    const u = byUid.get(uid);
    if (!u) { excluded.noUserDoc++; continue; }
    const active = u.premiumExpiresAt && u.premiumExpiresAt > now;
    if (u.premium) { excluded[u.premiumPeriodType === "TRIAL" ? "trial" : "premium"]++; }
    else if (u.premiumPeriodType === "TRIAL" && active) excluded.trial++;
    else if (active) excluded.activeEntitlement++;
    else eligible.push(u);
  }
  const eligibleUids = eligible.map((u) => u.uid);
  const eligibleSet = new Set(eligibleUids);

  const devices = await DeviceUsage.find({ uids: { $in: eligibleUids } }).lean();
  const deletable = devices.filter((d) => d.uids.length > 0 && d.uids.every((x) => eligibleSet.has(x)));
  const deletableIds = new Set(deletable.map((d) => String(d._id)));
  const kept = devices.filter((d) => !deletableIds.has(String(d._id)));
  const blocked = new Set(kept.filter((d) => d.usageCredits >= 3).flatMap((d) => d.uids.filter((x) => eligibleSet.has(x))));

  const langRows = await Event.aggregate([
    { $match: { eventName: "language_changed", "params.type": "app_language", uid: { $in: eligibleUids } } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: "$uid", language: { $last: "$params.language" } } },
  ]);
  const langByUid = new Map(langRows.map((r) => [r._id, r.language]));

  const recipients = eligible.map((u) => {
    // Prefer the language the client reported (User.appLanguage); the language_changed
    // event is the fallback for users who have not opened a newer app version yet.
    const lang = LOCALES.includes(u.appLanguage) ? u.appLanguage : langByUid.get(u.uid);
    const known = LOCALES.includes(lang);
    const hadToken = !!u.pushToken && Expo.isExpoPushToken(u.pushToken);
    const blockedByDevice = blocked.has(u.uid);
    return {
      uid: u.uid,
      platform: u.pushPlatform || null,
      language: known ? lang : "en",
      languageKnown: known,
      hadToken,
      blockedByDevice,
      pushEligible: hadToken && !blockedByDevice,
    };
  });
  return { eligibleUids, excluded, deletable, kept, recipients };
}

const summarize = (p) => ({
  eligible: p.eligibleUids.length,
  excluded: p.excluded,
  devicesToDelete: p.deletable.length,
  devicesKept: p.kept.length,
  usersBlockedByKeptDevice: p.recipients.filter((r) => r.blockedByDevice).length,
  pushEligible: p.recipients.filter((r) => r.pushEligible).length,
  pushEligibleKnownLanguage: p.recipients.filter((r) => r.pushEligible && r.languageKnown).length,
});

// ---------- apply ----------
async function apply() {
  const existing = await Recipient.countDocuments({ campaign: CAMPAIGN });
  if (existing > 0) throw new Error(`Campaign already applied (${existing} recipients). Refusing to run twice.`);

  const plan = await buildPlan();
  console.log("PLAN", JSON.stringify(summarize(plan)));

  // 3. Backup (full docs, EJSON so ObjectIds/Dates restore exactly) BEFORE any delete.
  const usages = await Usage.find({ uid: { $in: plan.eligibleUids } }).lean();
  const deviceDocs = plan.deletable;
  const date = new Date().toISOString().slice(0, 10);
  const file = path.resolve("backups", `credits_reset_${date}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) throw new Error(`Backup file already exists: ${file}`);
  const EJSON = mongoose.mongo.BSON.EJSON;
  fs.writeFileSync(file, EJSON.stringify({ campaign: CAMPAIGN, createdAt: new Date(), usages, deviceusages: deviceDocs }, undefined, 2, { relaxed: false }));
  const check = EJSON.parse(fs.readFileSync(file, "utf8"));
  if (check.usages.length !== usages.length || check.deviceusages.length !== deviceDocs.length) {
    throw new Error("Backup verification failed — nothing deleted.");
  }
  console.log(`BACKUP OK: ${file} (${usages.length} usages, ${deviceDocs.length} deviceusages)`);

  // 7. Register recipients first (so the report can join on them even if a later step fails).
  const resetAt = new Date();
  await Recipient.insertMany(plan.recipients.map((r) => ({
    ...r, campaign: CAMPAIGN, creditsResetAt: resetAt, status: r.pushEligible ? "pending" : "skipped",
  })), { ordered: false });

  // 4. Delete. Guards re-check at delete time (race-safe).
  const u = await Usage.deleteMany({ uid: { $in: plan.eligibleUids }, $expr: { $gte: ["$usageCredits", "$freeLimit"] } });
  const d = await DeviceUsage.deleteMany({
    _id: { $in: deviceDocs.map((x) => x._id) },
    uids: { $not: { $elemMatch: { $nin: plan.eligibleUids } } },
  });
  console.log(`DELETED: usages=${u.deletedCount} deviceusages=${d.deletedCount}`);
}

// ---------- send ----------
async function send() {
  const pending = await Recipient.countDocuments({ campaign: CAMPAIGN, status: "pending" });
  console.log(`pending recipients: ${pending}${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ""}`);
  const expo = new Expo(process.env.EXPO_ACCESS_TOKEN ? { accessToken: process.env.EXPO_ACCESS_TOKEN } : {});
  const stats = { sent: 0, failed: 0, skipped: 0 };
  let claimedTotal = 0;

  while (claimedTotal < LIMIT) {
    // Atomically claim up to 100 pending recipients: pending -> sending. A claimed row is
    // never picked up again, so a crash or re-run can't double-send (worst case: unsent).
    const batch = [];
    while (batch.length < Math.min(100, LIMIT - claimedTotal)) {
      const r = await Recipient.findOneAndUpdate(
        { campaign: CAMPAIGN, status: "pending" }, { $set: { status: "sending" } }, { returnDocument: "after" });
      if (!r) break;
      batch.push(r);
    }
    if (!batch.length) break;
    claimedTotal += batch.length;

    const users = await User.find({ uid: { $in: batch.map((r) => r.uid) } }).select("uid premium pushToken").lean();
    const userBy = new Map(users.map((u) => [u.uid, u]));
    const msgs = [], rows = [];
    for (const r of batch) {
      const u = userBy.get(r.uid);
      if (!u || u.premium || !Expo.isExpoPushToken(u.pushToken)) {
        await Recipient.updateOne({ _id: r._id }, { $set: { status: "skipped", error: "no longer eligible/token" } });
        stats.skipped++; continue;
      }
      const [title, body] = MESSAGES[r.language] || MESSAGES.en;
      msgs.push({ to: u.pushToken, sound: "default", title, body, priority: "high", channelId: ANDROID_CHANNEL,
        data: { campaign: CAMPAIGN } });
      rows.push(r);
    }
    if (!msgs.length) continue;

    let tickets;
    try {
      tickets = await expo.sendPushNotificationsAsync(msgs);
    } catch (e) {
      for (const r of rows) await Recipient.updateOne({ _id: r._id }, { $set: { status: "failed", error: e.message } });
      stats.failed += rows.length; console.error("chunk failed:", e.message); continue;
    }
    const now = new Date();
    for (let i = 0; i < rows.length; i++) {
      const t = tickets[i], r = rows[i];
      if (t?.status === "ok") {
        await Recipient.updateOne({ _id: r._id }, { $set: { status: "sent", sentAt: now, ticketId: t.id || null } });
        await Event.create({ eventName: "campaign_push_sent", distinctId: r.uid, uid: r.uid, platform: r.platform,
          params: { campaign: CAMPAIGN, language: r.language } });
        stats.sent++;
      } else {
        const code = t?.details?.error || "UNKNOWN";
        await Recipient.updateOne({ _id: r._id }, { $set: { status: "failed", error: `${code}: ${t?.message || ""}` } });
        if (code === "DeviceNotRegistered") await User.updateOne({ uid: r.uid }, { $set: { pushToken: null } });
        stats.failed++;
      }
    }
    console.log("progress", JSON.stringify(stats));
  }
  console.log("SEND DONE", JSON.stringify(stats));
}

if (APPLY && SEND) throw new Error("Run --apply and --send as separate steps.");
if (APPLY) await apply();
else if (SEND) await send();
else console.log("PLAN ONLY", JSON.stringify(summarize(await buildPlan()), null, 2));
await mongoose.disconnect();
