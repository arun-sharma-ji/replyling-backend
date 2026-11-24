import mongoose from "mongoose";

// One row per message in a user's single support conversation (Settings >
// Help & feedback in the app, answered from the website admin). Text only.
//
// Retention: a TTL index deletes each message 12 months after it was written
// (MongoDB's TTL monitor runs about once a minute). Messages are also deleted
// immediately when the user deletes their account (user.controller.js).
export const SUPPORT_RETENTION_SECONDS = 365 * 24 * 60 * 60;
export const SUPPORT_MAX_LENGTH = 2000;

const supportMessageSchema = new mongoose.Schema(
  {
    // From the verified Firebase token (user messages) or the admin's target (replies).
    uid: { type: String, required: true },

    sender: { type: String, enum: ["user", "admin"], required: true },
    text: { type: String, required: true, maxlength: SUPPORT_MAX_LENGTH },

    // Whether the other side has opened the message. For a user message this
    // means "admin has read it"; for an admin reply, "user has read it".
    read: { type: Boolean, default: false },

    // Context captured with user messages, shown to the admin. Not sensitive.
    platform: { type: String, enum: ["ios", "android", null], default: null },
    appVersion: { type: String, default: null },
    appLanguage: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

supportMessageSchema.index({ uid: 1, createdAt: 1 });
supportMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: SUPPORT_RETENTION_SECONDS });

export default mongoose.model("SupportMessage", supportMessageSchema);
