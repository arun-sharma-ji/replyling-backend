import DeviceUsage from "../models/DeviceUsage.js";

// Finds (or creates) the device record and links this uid to it. Fails open:
// a database hiccup must never block a legitimate translation, it only means
// device-level counting is skipped for this request.
export async function touchDeviceUsage({ deviceHash, platform, uid }) {
  if (!deviceHash) return null;

  const run = () =>
    DeviceUsage.findOneAndUpdate(
      { deviceHash },
      {
        $setOnInsert: { deviceHash },
        $set: { lastSeenAt: new Date(), ...(platform ? { platform } : {}) },
        $addToSet: { uids: uid },
      },
      { upsert: true, returnDocument: "after" }
    );

  try {
    try {
      return await run();
    } catch (error) {
      // Two first requests racing to create the same device record.
      if (error?.code === 11000) return await run();
      throw error;
    }
  } catch (error) {
    console.error("[deviceUsage] touch failed (non-fatal):", error.message);
    return null;
  }
}

// Called on account deletion: unlink this uid from every device record so
// nothing ties the record to the deleted person any more.
//
// The record itself is deliberately KEPT (hashed device id + free-credits-used
// counter + one-time-bonus mark, no account link). If it were deleted, deleting
// the account and signing up again on the same phone would hand out fresh free
// credits and a second one-time bonus. Records expire on their own after
// DEVICE_RECORD_TTL_DAYS without use (see models/DeviceUsage.js). This is
// disclosed in the privacy policy (anti-abuse, not tied to an account).
export async function removeUidFromDeviceUsage(uid) {
  const result = await DeviceUsage.updateMany({ uids: uid }, { $pull: { uids: uid } });
  return result.modifiedCount || 0;
}
