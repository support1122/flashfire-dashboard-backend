import sgMail from "@sendgrid/mail";
import dotenv from 'dotenv'; 
dotenv.config();



  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export async function sendOtpEmail(to, otp, minutes = 10) {
  console.log(process.env.SENDGRID_API_KEY, process.env.SENDGRID_FROM_EMAIL);
  const msg = {
    to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: "Your FlashFire login code",
    text: `Your login code is ${otp}. It expires in ${minutes} minutes.`,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto">
        <p>Your login code is</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p>
        <p>This code expires in <b>${minutes} minutes</b>.</p>
      </div>`
  };
  await sgMail.send(msg);
}
