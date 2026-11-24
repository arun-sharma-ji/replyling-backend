import mongoose from "mongoose";

// Single document ("main") remembering which ElevenLabs API key is currently
// in use and which keys are out of credits, so every server instance (Vercel
// runs many) starts from the right key instead of the first one each time.
//
// Keys are identified by a short one-way fingerprint, never stored themselves.
const elevenLabsKeyStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: "main" },
  // Fingerprint of the key that last worked (where the next request starts).
  activeFingerprint: { type: String, default: null },
  // fingerprint -> date until which that key is skipped (out of credits,
  // invalid, or briefly rate limited).
  unavailableUntil: { type: Map, of: Date, default: {} },
});

export default mongoose.model("ElevenLabsKeyState", elevenLabsKeyStateSchema);
