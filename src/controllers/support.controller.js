import SupportMessage, { SUPPORT_MAX_LENGTH } from "../models/SupportMessage.js";
import User from "../models/User.js";
import { notifySupportReply } from "../services/pushNotification.service.js";
import { isAuthorized } from "./admin.controller.js";

// Help & feedback: a single text-only conversation per user. Users talk to it
// from the app (auth'd, uid from the verified token); the website admin reads
// and replies through the shared-secret /api/admin/support/* routes below.

const HOUR_MS = 60 * 60 * 1000;
const MAX_USER_MESSAGES_PER_HOUR = 10;
const MAX_USER_MESSAGES_PER_DAY = 30;
const MAX_THREAD_MESSAGES = 300;

const cleanString = (value, max) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

const publicMessage = (m) => ({
  id: String(m._id),
  sender: m.sender,
  text: m.text,
  createdAt: m.createdAt,
});

/* ----------------------------- user (app) ----------------------------- */

// GET /api/user/support/messages — the conversation. Opening it marks the
// team's replies as read.
const getMessages = async (req, res) => {
  try {
    const uid = req.user.uid;
    const messages = await SupportMessage.find({ uid })
      .sort({ createdAt: -1 })
      .limit(MAX_THREAD_MESSAGES)
      .lean();
    messages.reverse();
    await SupportMessage.updateMany({ uid, sender: "admin", read: false }, { $set: { read: true } });
    res.json({ success: true, messages: messages.map(publicMessage) });
  } catch (error) {
    console.error("[support] getMessages failed:", error);
    res.status(500).json({ success: false, message: "Could not load messages." });
  }
};

// GET /api/user/support/unread — number of unread replies, for a badge.
const getUnread = async (req, res) => {
  try {
    const unread = await SupportMessage.countDocuments({
      uid: req.user.uid,
      sender: "admin",
      read: false,
    });
    res.json({ success: true, unread });
  } catch (error) {
    console.error("[support] getUnread failed:", error);
    res.status(500).json({ success: false, message: "Could not load." });
  }
};

// POST /api/user/support/messages { text, appVersion?, appLanguage? }
const sendMessage = async (req, res) => {
  try {
    const uid = req.user.uid;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ success: false, code: "empty", message: "Message is empty." });
    }
    if (text.length > SUPPORT_MAX_LENGTH) {
      return res.status(400).json({ success: false, code: "too-long", message: "Message is too long." });
    }

    // Basic abuse limits (per account).
    const now = Date.now();
    const [lastHour, lastDay] = await Promise.all([
      SupportMessage.countDocuments({ uid, sender: "user", createdAt: { $gte: new Date(now - HOUR_MS) } }),
      SupportMessage.countDocuments({ uid, sender: "user", createdAt: { $gte: new Date(now - 24 * HOUR_MS) } }),
    ]);
    if (lastHour >= MAX_USER_MESSAGES_PER_HOUR || lastDay >= MAX_USER_MESSAGES_PER_DAY) {
      return res
        .status(429)
        .json({ success: false, code: "rate-limited", message: "Too many messages. Please try again later." });
    }

    const platformHeader = String(req.get("x-platform") || "").toLowerCase();
    const message = await SupportMessage.create({
      uid,
      sender: "user",
      text,
      platform: platformHeader === "ios" || platformHeader === "android" ? platformHeader : null,
      appVersion: cleanString(req.body?.appVersion, 20),
      appLanguage: cleanString(req.body?.appLanguage, 10),
    });

    res.status(201).json({ success: true, message: publicMessage(message) });
  } catch (error) {
    console.error("[support] sendMessage failed:", error);
    res.status(500).json({ success: false, message: "Could not send message." });
  }
};

/* --------------------------- admin (website) --------------------------- */

// GET /api/admin/support/threads?secret=...&needsReply=1
// One row per user: latest message + whether it is waiting for a reply.
const adminListThreads = async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ success: false, message: "Unauthorized." });
  try {
    const rows = await SupportMessage.aggregate([
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: "$uid",
          lastText: { $last: "$text" },
          lastSender: { $last: "$sender" },
          lastAt: { $last: "$createdAt" },
          messageCount: { $sum: 1 },
          unread: {
            $sum: { $cond: [{ $and: [{ $eq: ["$sender", "user"] }, { $eq: ["$read", false] }] }, 1, 0] },
          },
          platform: { $last: "$platform" },
          appVersion: { $last: "$appVersion" },
          appLanguage: { $last: "$appLanguage" },
        },
      },
      { $sort: { lastAt: -1 } },
      { $limit: 300 },
    ]);

    const users = await User.find({ uid: { $in: rows.map((r) => r._id) } })
      .select("uid email guest premium premiumPeriodType appLanguage")
      .lean();
    const byUid = new Map(users.map((u) => [u.uid, u]));

    let threads = rows.map((r) => {
      const u = byUid.get(r._id);
      return {
        uid: r._id,
        email: u?.email || null,
        isGuest: u?.guest === true,
        plan: u ? (u.premium ? (u.premiumPeriodType === "TRIAL" ? "trial" : "paid") : "free") : "deleted",
        appLanguage: u?.appLanguage || r.appLanguage || null,
        platform: r.platform || null,
        appVersion: r.appVersion || null,
        lastText: String(r.lastText || "").slice(0, 200),
        lastSender: r.lastSender,
        lastAt: r.lastAt,
        messageCount: r.messageCount,
        unread: r.unread,
        needsReply: r.lastSender === "user",
      };
    });
    if (req.query.needsReply === "1") threads = threads.filter((t) => t.needsReply);

    res.json({ success: true, threads, needsReplyCount: threads.filter((t) => t.needsReply).length });
  } catch (error) {
    console.error("[support] adminListThreads failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/support/thread?secret=...&uid=... — also marks the user's
// messages as read.
const adminGetThread = async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ success: false, message: "Unauthorized." });
  const uid = typeof req.query.uid === "string" ? req.query.uid : "";
  if (!uid) return res.status(400).json({ success: false, message: "uid is required." });
  try {
    const [messages, user] = await Promise.all([
      SupportMessage.find({ uid }).sort({ createdAt: -1 }).limit(MAX_THREAD_MESSAGES).lean(),
      User.findOne({ uid }).select("email guest premium premiumPeriodType appLanguage").lean(),
    ]);
    messages.reverse();
    await SupportMessage.updateMany({ uid, sender: "user", read: false }, { $set: { read: true } });
    res.json({
      success: true,
      user: user
        ? {
            email: user.email || null,
            isGuest: user.guest === true,
            plan: user.premium ? (user.premiumPeriodType === "TRIAL" ? "trial" : "paid") : "free",
            appLanguage: user.appLanguage || null,
          }
        : null,
      messages: messages.map((m) => ({ ...publicMessage(m), platform: m.platform, appVersion: m.appVersion })),
    });
  } catch (error) {
    console.error("[support] adminGetThread failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/admin/support/reply?secret=... { uid, text } — saves the reply and
// pushes the user (any plan; see notifySupportReply).
const adminReply = async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ success: false, message: "Unauthorized." });
  const uid = typeof req.body?.uid === "string" ? req.body.uid : "";
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!uid || !text) return res.status(400).json({ success: false, message: "uid and text are required." });
  if (text.length > SUPPORT_MAX_LENGTH) {
    return res.status(400).json({ success: false, message: `Reply max ${SUPPORT_MAX_LENGTH} characters.` });
  }
  try {
    const exists = await User.exists({ uid });
    if (!exists) return res.status(404).json({ success: false, message: "That user no longer exists." });

    const message = await SupportMessage.create({ uid, sender: "admin", text });
    // Everything the user wrote so far has now been answered.
    await SupportMessage.updateMany({ uid, sender: "user", read: false }, { $set: { read: true } });
    const push = await notifySupportReply(uid);
    res.status(201).json({ success: true, message: publicMessage(message), pushed: push.ok === true });
  } catch (error) {
    console.error("[support] adminReply failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export { getMessages, getUnread, sendMessage, adminListThreads, adminGetThread, adminReply };
