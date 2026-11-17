import { getBonusEligibility, claimBonusReset } from "../services/bonusCredits.service.js";

// GET /api/user/bonus-credits   (auth, optional device id)
// -> { success, eligible, credits }
const getBonusOffer = async (req, res) => {
  try {
    const { eligible, credits } = await getBonusEligibility({
      uid: req.user.uid,
      deviceHash: req.deviceHash,
    });
    return res.status(200).json({ success: true, eligible, credits });
  } catch (error) {
    console.error("[bonus] eligibility check failed:", error.message);
    // Fail closed: no offer is better than a wrong one.
    return res.status(200).json({ success: true, eligible: false, credits: 0 });
  }
};

// POST /api/user/bonus-credits/claim   (auth, optional device id)
// -> 200 { success, remainingFreeTranslations } | 409 { errorCode: "BONUS_NOT_AVAILABLE" }
const claimBonus = async (req, res) => {
  try {
    const result = await claimBonusReset({ uid: req.user.uid, deviceHash: req.deviceHash });
    if (!result.ok) {
      return res.status(409).json({
        success: false,
        errorCode: "BONUS_NOT_AVAILABLE",
        message: "This bonus is not available.",
      });
    }
    return res.status(200).json({
      success: true,
      remainingFreeTranslations: result.remainingFreeTranslations,
    });
  } catch (error) {
    console.error("[bonus] claim failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not apply the bonus. Please try again." });
  }
};

export { getBonusOffer, claimBonus };
