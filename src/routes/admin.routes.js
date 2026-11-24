import express from "express";
import { getCreditsBackReport, getFunnelReport, getUserJourney, getAiUsageReport, getTrafficReport, getNotificationAudience, sendNotification, getPurchaseSurveyReport } from "../controllers/admin.controller.js";

import { adminListThreads, adminGetThread, adminReply } from "../controllers/support.controller.js";

const router = express.Router();

// Shared-secret protected (see admin.controller.js's isAuthorized), same
// pattern as notifications.routes.js — there's no admin-role concept on
// User yet, and these are meant for direct browser/curl use, not the app.
router.get("/credits-back-report", getCreditsBackReport);
router.get("/funnel", getFunnelReport);
router.get("/user-journey", getUserJourney);
router.get("/ai-usage", getAiUsageReport);
router.get("/traffic", getTrafficReport);
router.get("/purchase-survey", getPurchaseSurveyReport);
router.get("/notification-audience", getNotificationAudience);
router.post("/send-notification", sendNotification);

// Help & feedback inbox (see support.controller.js).
router.get("/support/threads", adminListThreads);
router.get("/support/thread", adminGetThread);
router.post("/support/reply", adminReply);

export default router;
