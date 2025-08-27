// middlewares/validateOtpBodies.js
export function validateRequestOtpBody(req, res, next) {
  const email = (req.body.email || "").trim();
  if (!email) return res.status(400).json({ message: "Email is required" });
  next();
}

export function validateVerifyOtpBody(req, res, next) {
  const email = (req.body.email || "").trim();
  const otp   = (req.body.otp || "").trim();
  if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required" });
  next();
}
