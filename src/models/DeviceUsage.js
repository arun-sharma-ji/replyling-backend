import mongoose from "mongoose";

// Inactive device records are removed after this long (anti-abuse data should
// not be kept forever). Keep the privacy policy in step if you change it.
export const DEVICE_RECORD_TTL_DAYS = 365;

// Free-tier usage per DEVICE, so deleting/reinstalling the app or creating
// extra accounts on one phone can't mint more free translations. The raw
// device id (iOS Keychain install id / Android ID) is never stored — only an
// HMAC of it (see utils/deviceHash.js).
const deviceUsageSchema = new mongoose.Schema(
  {
    deviceHash: {
      type: String,
      required: true,
      unique: true,
    },

    // "ios" | "android" — informational.
    platform: {
      type: String,
      default: null,
    },

    // Free credits used on this device across ALL accounts. Never reset.
    usageCredits: {
      type: Number,
      default: 0,
    },

    // Accounts seen on this device. Lets account deletion remove its link
    // (and the whole record once no account is left).
    uids: {
      type: [String],
      default: [],
      index: true,
    },

    // One-time bonus reset already used on this device (any account). Set
    // together with the account flag so a new/guest account on the same phone
    // can't claim it again. Never cleared.
    bonusResetClaimedAt: {
      type: Date,
      default: null,
    },

    // Also drives the automatic expiry below: a device not seen for
    // DEVICE_RECORD_TTL_DAYS is dropped by MongoDB itself.
    lastSeenAt: {
      type: Date,
      default: Date.now,
      index: { expireAfterSeconds: DEVICE_RECORD_TTL_DAYS * 24 * 60 * 60 },
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("DeviceUsage", deviceUsageSchema);
