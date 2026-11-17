import express from "express";
import multer from "multer";

import auth from "../middleware/auth.js";
import deviceId from "../middleware/deviceId.js";
import requireSignedIn from "../middleware/requireSignedIn.js";
import usageLimit from "../middleware/usageLimit.js";
import {
  translateMessage,
  translateTextMessage,
} from "../controllers/translate.controller.js";

const router = express.Router();

// Store uploaded audio temporarily in uploads/
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // ~15MB hard ceiling, well above a real 3-min clip
  },
});

router.post(
  "/message",
  deviceId,
  auth,
  requireSignedIn,
  usageLimit,
  upload.single("audio"),
  translateMessage
);

// Text translation (typed / pasted / dictated). Deliberately NOT behind
// usageLimit: it never touches the voice credits; it has its own daily cap
// (see services/textDailyLimit.service.js): 50/day free, 100/day Pro.
router.post(
  "/text",
  deviceId,
  auth,
  requireSignedIn,
  upload.single("audio"),
  translateTextMessage
);

export default router;