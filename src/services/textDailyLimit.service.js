import Usage from "../models/Usage.js";

// Daily cap on text translations (typed, pasted, dictated, text replies),
// separate from the voice credits (usageCredits / freeLimit) — text never
// spends those.
//   free users: 50 a day     pro users: 100 a day
// The day is the UTC calendar day. Override with TEXT_DAILY_LIMIT_FREE /
// TEXT_DAILY_LIMIT_PRO (handy for testing the limit path).
const readLimit = (envName, fallback) => {
  const fromEnv = Number.parseInt(process.env[envName], 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : fallback;
};

export const getTextDailyLimit = (isPremium) =>
  isPremium ? readLimit("TEXT_DAILY_LIMIT_PRO", 100) : readLimit("TEXT_DAILY_LIMIT_FREE", 50);

const todayUtc = () => new Date().toISOString().slice(0, 10);

const buildUsage = (count, limit) => ({
  used: count,
  limit,
  remaining: Math.max(0, limit - count),
});

/**
 * Atomically claims one text slot for today.
 * Returns { ok: true, usage } on success, or { ok: false, usage } when the
 * daily cap is already reached. Call refundTextSlot() if the AI work fails so
 * a failed request doesn't eat the user's allowance.
 */
export async function claimTextSlot(uid, isPremium = false) {
  const limit = getTextDailyLimit(isPremium);
  const today = todayUtc();

  // Up to 2 passes: the second one covers losing the race that creates the
  // user's Usage document (duplicate-key on upsert).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // 1. Same day, still under the cap -> take a slot.
    const sameDay = await Usage.findOneAndUpdate(
      { uid, textDailyDate: today, textDailyCount: { $lt: limit } },
      { $inc: { textDailyCount: 1 } },
      { returnDocument: "after" }
    );
    if (sameDay) return { ok: true, usage: buildUsage(sameDay.textDailyCount, limit) };

    // 2. New day (or first ever text use) -> start the counter at 1.
    try {
      const newDay = await Usage.findOneAndUpdate(
        { uid, textDailyDate: { $ne: today } },
        { $set: { textDailyDate: today, textDailyCount: 1 } },
        { returnDocument: "after", upsert: true }
      );
      if (newDay) return { ok: true, usage: buildUsage(newDay.textDailyCount, limit) };
    } catch (error) {
      // 11000 = the doc already exists for today (filter didn't match, upsert
      // tried to insert a second doc for this uid). Either the cap is reached
      // or another request just created/rolled the doc: loop once more.
      if (error?.code !== 11000) throw error;
    }
  }

  const current = await Usage.findOne({ uid }).select("textDailyCount textDailyDate");
  const count = current?.textDailyDate === today ? current.textDailyCount || 0 : 0;
  return { ok: false, usage: buildUsage(count, limit) };
}

/** Gives a claimed slot back (the request failed before delivering a result). */
export async function refundTextSlot(uid) {
  const today = todayUtc();
  await Usage.updateOne(
    { uid, textDailyDate: today, textDailyCount: { $gt: 0 } },
    { $inc: { textDailyCount: -1 } }
  ).catch((error) => console.error("[textDailyLimit] refund failed:", error.message));
}
