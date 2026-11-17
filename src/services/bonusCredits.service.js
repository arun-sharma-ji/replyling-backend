import Usage from "../models/Usage.js";
import User from "../models/User.js";
import DeviceUsage from "../models/DeviceUsage.js";
import PurchaseSurvey from "../models/PurchaseSurvey.js";

// One-time "try it more" bonus.
//
// Who gets it: a FREE user who started checkout, cancelled, and answered the
// purchase survey with "I wanted to try it more first" (reason "want_trial"),
// and who has actually used some of their free allowance (otherwise there is
// nothing to give back).
//
// What it is: a full reset of the free allowance - the account's and the
// device's used-credit counters go back to 0 (free usage is the larger of the
// two, so both must be reset or the device counter would keep blocking them).
//
// One time only: enforced on the SERVER, by the account AND by the device, so
// reinstalling, a second account or a guest account on the same phone can't
// claim it again. The survey answer itself is never the reward - the client
// shows a separate offer and the user chooses whether to claim it.

export const BONUS_SURVEY_REASON = "want_trial";

const freeUsedOf = (usage, deviceUsage) =>
  Math.max(usage?.usageCredits || 0, deviceUsage?.usageCredits || 0);

async function loadState({ uid, deviceHash }) {
  const [user, usage, deviceUsage, answeredWantTrial] = await Promise.all([
    User.findOne({ uid }).select("premium").lean(),
    Usage.findOne({ uid }).lean(),
    deviceHash ? DeviceUsage.findOne({ deviceHash }).lean() : null,
    PurchaseSurvey.exists({ uid, reason: BONUS_SURVEY_REASON }),
  ]);
  return { user, usage, deviceUsage, answeredWantTrial: !!answeredWantTrial };
}

// -> { eligible, reason, credits }   (reason only explains a "no", for logs)
export async function getBonusEligibility({ uid, deviceHash }) {
  const { user, usage, deviceUsage, answeredWantTrial } = await loadState({ uid, deviceHash });
  const credits = usage?.freeLimit ?? 3;

  if (user?.premium) return { eligible: false, reason: "premium", credits };
  if (!answeredWantTrial) return { eligible: false, reason: "not_asked", credits };
  if (usage?.bonusResetClaimedAt) return { eligible: false, reason: "account_claimed", credits };
  if (deviceUsage?.bonusResetClaimedAt) return { eligible: false, reason: "device_claimed", credits };
  if (freeUsedOf(usage, deviceUsage) <= 0) return { eligible: false, reason: "nothing_used", credits };
  return { eligible: true, reason: null, credits };
}

// Atomically claims the bonus. Resolves
//   { ok: true, remainingFreeTranslations }  or
//   { ok: false, reason }                    (same reasons as above)
export async function claimBonusReset({ uid, deviceHash }) {
  const eligibility = await getBonusEligibility({ uid, deviceHash });
  if (!eligibility.eligible) return { ok: false, reason: eligibility.reason };

  const now = new Date();

  // 1) Claim the DEVICE first (atomic: only if not yet claimed). The device row
  //    exists here whenever deviceHash is set, because /me and the usage
  //    middleware create it.
  let deviceClaimed = false;
  if (deviceHash) {
    const dev = await DeviceUsage.findOneAndUpdate(
      { deviceHash, bonusResetClaimedAt: null },
      { $set: { bonusResetClaimedAt: now, usageCredits: 0 } },
      { returnDocument: "after" }
    );
    if (!dev) return { ok: false, reason: "device_claimed" };
    deviceClaimed = true;
  }

  // 2) Claim the ACCOUNT (atomic as well).
  const usage = await Usage.findOneAndUpdate(
    { uid, bonusResetClaimedAt: null },
    { $set: { bonusResetClaimedAt: now, usageCredits: 0 } },
    { returnDocument: "after" }
  );
  if (!usage) {
    // Lost a race / already claimed on this account: undo the device claim so
    // the flag only ever reflects a reset that really happened.
    if (deviceClaimed) {
      await DeviceUsage.updateOne(
        { deviceHash, bonusResetClaimedAt: now },
        { $set: { bonusResetClaimedAt: null } }
      );
    }
    return { ok: false, reason: "account_claimed" };
  }

  return { ok: true, remainingFreeTranslations: usage.freeLimit };
}
