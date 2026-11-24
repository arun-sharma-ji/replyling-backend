import { Expo } from "expo-server-sdk";
import User from "../models/User.js";
import CronState from "../models/CronState.js";
import { TRIAL_ENDING_MESSAGES } from "../config/trialEndingMessages.js";
import { REENGAGEMENT_MESSAGES } from "../config/reengagementMessages.js";
import { SUPPORT_REPLY_MESSAGES } from "../config/supportReplyMessages.js";

// NOTIFICATION POLICY: only FREE users get marketing pushes (re-engagement,
// broadcasts) — they're the ones we want to convert. Trial and paid users get
// none, with ONE exception: a single "trial ends tomorrow" push per trial
// (runTrialEndingBatch below). Every marketing query must spread
// freeUserFilter() so that rule can't be bypassed.
function freeUserFilter(now = new Date()) {
  return {
    premium: { $ne: true },
    // Defensive: never treat someone with a still-valid entitlement as free,
    // even if the premium flag lags behind a webhook.
    $and: [{ $or: [{ premiumExpiresAt: null }, { premiumExpiresAt: { $lte: now } }] }],
  };
}

const TRIAL_REMINDER_HOURS = 24; // send when the trial has <= this long left
const MIN_MINUTES_BETWEEN_TRIAL_RUNS = 10; // throttle so frequent pings stay cheap

// Must match ANDROID_NOTIFICATION_CHANNEL_ID in ReplyLingo-Mobile/src/utils/pushNotifications.js.
// Android ignores per-notification sound on API 26+ — it's the channel's sound
// that plays, so this has to point at a channel the client actually created.
const ANDROID_NOTIFICATION_CHANNEL_ID = "default-v2";

// Days of inactivity (since lastActiveAt) at which push 1, 2, 3 and 4 are due.
// After push 4 the user is left alone; opening the app resets the sequence
// (getMe sets reengagementStage back to 0).
const REENGAGEMENT_INACTIVE_DAYS = [3, 7, 14, 30];
const RESEND_GAP_DAYS = 4; // never push the same user more often than this
// UTC hours in which the re-engagement batch may send (12:00-16:59 UTC =
// evening in South Asia, afternoon in Europe, morning in the Americas).
const SEND_WINDOW_START_UTC = 12;
const SEND_WINDOW_END_UTC = 17;
const MIN_HOURS_BETWEEN_RUNS = 20; // lets an uptime monitor ping often without double-sending

// How many messages to send per Expo API call. There's no hard cap from
// Expo itself here (chunkPushNotifications() already splits into
// Expo-sized batches internally), this just bounds how many chunks are
// in flight at once for a large broadcast.
const ANNOUNCEMENT_CONCURRENCY = 6;

let expoClient;
function getExpoClient() {
  if (!expoClient) {
    expoClient = process.env.EXPO_ACCESS_TOKEN
      ? new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN })
      : new Expo();
  }
  return expoClient;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Clears a user's stale token so the next app launch re-registers a fresh
// one instead of the batch repeatedly failing against a dead token.
async function clearStaleToken(uid) {
  await User.updateOne({ uid }, { $set: { pushToken: null } });
}

// Sends one push notification via Expo's push service. Tokens left over
// from the old FCM/raw-APNs architecture aren't valid Expo push tokens —
// those get skipped (and cleared) rather than sent, so migration is
// self-healing as users' apps re-register on their next cold start.
async function sendPushNotification({ uid, token, title, body, data }) {
  if (!Expo.isExpoPushToken(token)) {
    await clearStaleToken(uid);
    return { ok: false, code: "invalid-token", message: "Not a valid Expo push token." };
  }

  const expo = getExpoClient();

  let tickets;
  try {
    tickets = await expo.sendPushNotificationsAsync([
      { to: token, sound: "default", title, body, channelId: ANDROID_NOTIFICATION_CHANNEL_ID, ...(data ? { data } : {}) },
    ]);
  } catch (error) {
    console.error(`[push] Failed to notify ${uid}:`, error.message);
    return { ok: false, code: error.code || "send-error", message: error.message };
  }

  const ticket = tickets[0];
  if (ticket.status === "error") {
    if (ticket.details?.error === "DeviceNotRegistered") {
      await clearStaleToken(uid);
    } else {
      console.error(`[push] Failed to notify ${uid}:`, ticket.message);
    }
    return { ok: false, code: ticket.details?.error || "UNKNOWN", message: ticket.message };
  }

  return { ok: true };
}

// The re-engagement batch: finds users who have a push token, haven't
// opened the app in INACTIVE_DAYS, and haven't already been nudged in the
// last RESEND_GAP_DAYS — then sends each one a reminder.
//
// Safe to call as often as an uptime monitor likes: it only actually runs
// if at least MIN_HOURS_BETWEEN_RUNS has passed since the last real run,
// tracked in the CronState collection. Everything else is a no-op.
export async function runReengagementBatch() {
  const state = await CronState.findOneAndUpdate(
    { key: "reengagement" },
    { $setOnInsert: { lastRunAt: null } },
    { upsert: true, returnDocument: "after" }
  );

  const hoursSinceLastRun = state.lastRunAt
    ? (Date.now() - state.lastRunAt.getTime()) / (1000 * 60 * 60)
    : Infinity;

  if (hoursSinceLastRun < MIN_HOURS_BETWEEN_RUNS) {
    return { ran: false, reason: "too soon since last run", hoursSinceLastRun };
  }

  // Only send in the daytime-ish window so pushes don't land at 3am for most
  // users (and the send time doesn't drift around the clock). Outside it we
  // return before claiming the run, so the first ping inside the window runs.
  const hourUtc = new Date().getUTCHours();
  if (hourUtc < SEND_WINDOW_START_UTC || hourUtc >= SEND_WINDOW_END_UTC) {
    return { ran: false, reason: "outside send window", hourUtc };
  }

  // Claim the run immediately so a second ping arriving while this batch
  // is still sending doesn't start a duplicate run.
  await CronState.updateOne({ key: "reengagement" }, { $set: { lastRunAt: new Date() } });

  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const resendCutoff = new Date(now - RESEND_GAP_DAYS * DAY);

  // One clause per step: a user at stage N is due once they've been inactive
  // for REENGAGEMENT_INACTIVE_DAYS[N] days. Stage 0 also matches users who
  // predate the field (missing => null). Stage 4 matches nothing: sequence over.
  const stageClauses = REENGAGEMENT_INACTIVE_DAYS.map((days, stage) => ({
    reengagementStage: stage === 0 ? { $in: [null, 0] } : stage,
    lastActiveAt: { $lte: new Date(now - days * DAY) },
  }));

  const query = {
    ...freeUserFilter(),
    pushToken: { $ne: null },
    $or: stageClauses,
  };
  // Minimum spacing between two pushes to the same user.
  query.$and.push({
    $or: [{ lastReengagementSentAt: null }, { lastReengagementSentAt: { $lte: resendCutoff } }],
  });

  const candidates = await User.find(query).select("uid pushToken appLanguage reengagementStage");

  let sent = 0;
  for (const user of candidates) {
    const stage = user.reengagementStage || 0;
    const steps = REENGAGEMENT_MESSAGES[user.appLanguage] || REENGAGEMENT_MESSAGES.en;
    const [title, body] = steps[stage];
    const result = await sendPushNotification({ uid: user.uid, token: user.pushToken, title, body });
    if (result.ok) {
      await User.updateOne(
        { uid: user.uid },
        { $set: { lastReengagementSentAt: new Date(), reengagementStage: stage + 1 } }
      );
      sent += 1;
    }
  }

  return { ran: true, candidates: candidates.length, sent };
}

// Tells a user the team replied in Help & feedback. This is the second (and
// last) exception to the "only free users get pushes" policy above: it is a
// direct answer to a message the user themselves sent, so it goes to ANY user
// (free, trial or paid) — and only when an admin actually replies. Never throws.
export async function notifySupportReply(uid) {
  try {
    const user = await User.findOne({ uid }).select("uid pushToken appLanguage").lean();
    if (!user?.pushToken) return { ok: false, reason: "no push token" };
    const [title, body] = SUPPORT_REPLY_MESSAGES[user.appLanguage] || SUPPORT_REPLY_MESSAGES.en;
    return await sendPushNotification({
      uid,
      token: user.pushToken,
      title,
      body,
      data: { type: "support" },
    });
  } catch (error) {
    console.error("[push] Support reply notify failed:", error.message);
    return { ok: false, reason: error.message };
  }
}

// The ONLY marketing-style notification a trial user ever gets: one push when their free trial
// has <= TRIAL_REMINDER_HOURS left. Fires at most once per trial —
// trialEndingNotifiedFor stores the premiumExpiresAt it was sent for, claimed
// atomically before sending so concurrent/repeated pings can't double-send.
// Paid users (period NORMAL) and free users never match.
//
// Called from the same pinged endpoint as the re-engagement batch, but with its
// own, much shorter throttle (the re-engagement one is 20h — far too coarse to
// hit a 24h window reliably). Ping the endpoint every 5-15 minutes.
export async function runTrialEndingBatch() {
  const state = await CronState.findOneAndUpdate(
    { key: "trial-ending" },
    { $setOnInsert: { lastRunAt: null } },
    { upsert: true, returnDocument: "after" }
  );
  const minutesSinceLastRun = state.lastRunAt
    ? (Date.now() - state.lastRunAt.getTime()) / (1000 * 60)
    : Infinity;
  if (minutesSinceLastRun < MIN_MINUTES_BETWEEN_TRIAL_RUNS) {
    return { ran: false, reason: "too soon since last run" };
  }
  await CronState.updateOne({ key: "trial-ending" }, { $set: { lastRunAt: new Date() } });

  const now = new Date();
  const windowEnd = new Date(now.getTime() + TRIAL_REMINDER_HOURS * 60 * 60 * 1000);

  const candidates = await User.find({
    premium: true,
    premiumPeriodType: "TRIAL",
    premiumExpiresAt: { $gt: now, $lte: windowEnd },
    pushToken: { $ne: null },
  }).select("uid pushToken appLanguage premiumExpiresAt trialEndingNotifiedFor");

  let sent = 0;
  for (const user of candidates) {
    // Claim first: only one run can win this (uid, trial-expiry) pair.
    const claim = await User.updateOne(
      {
        uid: user.uid,
        premium: true,
        premiumPeriodType: "TRIAL",
        premiumExpiresAt: user.premiumExpiresAt,
        trialEndingNotifiedFor: { $ne: user.premiumExpiresAt },
      },
      { $set: { trialEndingNotifiedFor: user.premiumExpiresAt } }
    );
    if (claim.modifiedCount === 0) continue;

    const [title, body] = TRIAL_ENDING_MESSAGES[user.appLanguage] || TRIAL_ENDING_MESSAGES.en;
    const result = await sendPushNotification({ uid: user.uid, token: user.pushToken, title, body });
    if (result.ok) {
      sent += 1;
    } else if (result.code !== "invalid-token" && result.code !== "DeviceNotRegistered") {
      // Transient failure: release the claim so the next ping retries.
      await User.updateOne({ uid: user.uid }, { $set: { trialEndingNotifiedFor: null } });
    }
  }

  return { ran: true, candidates: candidates.length, sent };
}

// Broadcasts one push notification to every FREE user with a saved push token —
// the ReplyLingo equivalent of FlexFlow's sendAnnouncementPushToTenantMembers,
// minus the tenant scoping (this app has no tenant concept, so it's just
// "every user"). Uses Expo's real chunking/ticket API instead of a
// hand-rolled per-user loop.
//
// `platform` narrows the audience: "android" | "ios" | "all" (default). The
// filter uses User.pushPlatform, recorded when the device registers its
// token — users who registered before that field existed have null and are
// only reachable with "all".
export const PUSH_PLATFORMS = ["android", "ios", "all"];

export async function sendAnnouncementPushToAllUsers({ title, body, platform = "all" }) {
  // Free users only — trial and paid users never receive broadcasts.
  const filter = { ...freeUserFilter(), pushToken: { $ne: null } };
  if (platform !== "all") filter.pushPlatform = platform;
  const users = await User.find(filter).select("uid pushToken");

  const validUsers = [];
  const invalidUids = [];
  for (const user of users) {
    if (Expo.isExpoPushToken(user.pushToken)) {
      validUsers.push(user);
    } else {
      invalidUids.push(user.uid);
    }
  }
  const invalidTokenCount = invalidUids.length;

  if (invalidTokenCount > 0) {
    // Fire-and-forget cleanup — doesn't block the send.
    User.updateMany({ uid: { $in: invalidUids } }, { $set: { pushToken: null } }).catch((error) =>
      console.error("[push] Stale token cleanup failed:", error.message)
    );
  }

  if (validUsers.length === 0) {
    return {
      sent: false,
      totalTargetUsers: users.length,
      invalidTokenCount,
      totalValidTokens: 0,
      totalTickets: 0,
      totalTicketErrors: 0,
      ticketErrors: [],
    };
  }

  const expo = getExpoClient();
  const messages = validUsers.map((user) => ({
    to: user.pushToken,
    sound: "default",
    title,
    body,
    priority: "high",
    channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
  }));

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const wave of chunk(chunks, ANNOUNCEMENT_CONCURRENCY)) {
    const waveTickets = await Promise.all(wave.map((c) => expo.sendPushNotificationsAsync(c)));
    tickets.push(...waveTickets.flat());
  }

  const staleUids = [];
  const ticketErrors = [];
  tickets.forEach((ticket, index) => {
    if (ticket.status !== "error") return;

    const uid = validUsers[index]?.uid;
    if (ticket.details?.error === "DeviceNotRegistered" && uid) {
      staleUids.push(uid);
    }
    ticketErrors.push({
      uid,
      code: ticket.details?.error || "UNKNOWN",
      message: ticket.message || "Unknown Expo push error",
    });
  });

  if (staleUids.length > 0) {
    await User.updateMany({ uid: { $in: staleUids } }, { $set: { pushToken: null } });
  }

  const totalTicketErrors = ticketErrors.length;
  if (totalTicketErrors > 0) {
    console.warn("[push] Announcement ticket errors:", ticketErrors);
  }

  return {
    sent: true,
    totalTargetUsers: users.length,
    invalidTokenCount,
    totalValidTokens: validUsers.length,
    totalTickets: tickets.length,
    totalTicketErrors,
    ticketErrors,
  };
}

// Sends one notification to a specific user immediately, bypassing the
// inactivity/resend/idempotency checks above entirely. For manually
// verifying delivery during development — never called by the batch job.
export async function sendTestNotification(uid) {
  const user = await User.findOne({ uid }).select("uid pushToken");

  if (!user) {
    return { ok: false, reason: "no such user" };
  }
  if (!user.pushToken) {
    return { ok: false, reason: "user has no pushToken saved" };
  }

  const result = await sendPushNotification({
    uid: user.uid,
    token: user.pushToken,
    title: "Test notification",
    body: "If you're seeing this, push notifications are working.",
  });

  return result;
}

// Owner alerts (e.g. a new RevenueCat payment). The owner is just a normal user
// doc, so their push token is read fresh from the DB on every send — it keeps
// working after a reinstall. OWNER_UID / OWNER_PUSH_TOKEN env vars override the
// built-in values below, which exist so alerts work with no env setup at all.
const DEFAULT_OWNER_UID = "KuDdcGWnpgXvc34QQUWW5tupMme2";
const FALLBACK_OWNER_PUSH_TOKEN = "ExponentPushToken[UThGmePUMsiik8HXCqgvOP]";

// Never throws — a failed alert must not affect whatever triggered it.
export async function notifyOwner({ title, body }) {
  try {
    const uid = process.env.OWNER_UID || DEFAULT_OWNER_UID;
    const owner = await User.findOne({ uid }).select("pushToken").lean();
    const token = [owner?.pushToken, process.env.OWNER_PUSH_TOKEN, FALLBACK_OWNER_PUSH_TOKEN].find((t) =>
      Expo.isExpoPushToken(t)
    );
    if (!token) return { ok: false, reason: "no valid owner push token" };

    const tickets = await getExpoClient().sendPushNotificationsAsync([
      { to: token, sound: "default", title, body, priority: "high", channelId: ANDROID_NOTIFICATION_CHANNEL_ID },
    ]);
    if (tickets[0]?.status === "error") {
      console.error("[owner-notify] Expo ticket error:", tickets[0].message);
      return { ok: false, reason: tickets[0].message };
    }
    return { ok: true };
  } catch (error) {
    console.error("[owner-notify] Failed:", error.message);
    return { ok: false, reason: error.message };
  }
}

// How many users a broadcast would reach, per platform — shown in the admin
// UI before sending so the button never fires blind.
export async function getPushAudienceCounts() {
  const rows = await User.aggregate([
    { $match: { ...freeUserFilter(), pushToken: { $ne: null } } },
    { $group: { _id: "$pushPlatform", count: { $sum: 1 } } },
  ]);
  const counts = { android: 0, ios: 0, unknown: 0 };
  rows.forEach((r) => {
    if (r._id === "android" || r._id === "ios") counts[r._id] = r.count;
    else counts.unknown += r.count;
  });
  return { ...counts, all: counts.android + counts.ios + counts.unknown };
}
