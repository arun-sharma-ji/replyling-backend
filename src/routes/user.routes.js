import express from "express";
import auth from "../middleware/auth.js";
import requireSignedIn from "../middleware/requireSignedIn.js";
import deviceId from "../middleware/deviceId.js";
import { getMe, updateVoice, previewVoice, syncPremium, deleteAccount, savePushToken } from "../controllers/user.controller.js";
import { getBonusOffer, claimBonus } from "../controllers/bonusCredits.controller.js";

const router = express.Router();

router.get("/me", deviceId, auth, getMe);
router.patch("/voice", auth, updateVoice);
router.post("/voice-preview", auth, requireSignedIn, previewVoice);
router.post("/sync-premium", auth, syncPremium);
router.delete("/account", auth, deleteAccount);
router.post("/push-token", auth, savePushToken);

// One-time "try it more" free-limit reset (see services/bonusCredits.service.js).
router.get("/bonus-credits", deviceId, auth, getBonusOffer);
router.post("/bonus-credits/claim", deviceId, auth, claimBonus);

export default router;