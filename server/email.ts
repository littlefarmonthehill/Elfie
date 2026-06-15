import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = "E.L.F.I.E. <noreply@planetbrick.com>";

function firstName(user: { firstName?: string | null; email: string }): string {
  return user.firstName || user.email.split("@")[0];
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string
): Promise<void> {
  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: "Reset your E.L.F.I.E. password",
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f172a;color:#e2e8f0;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#7c3aed,#ec4899,#06b6d4);padding:24px 32px;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;">E.L.F.I.E.</h1>
            <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">PlanetBrick Platform</p>
          </div>
          <div style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;">Hi ${name},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;">
              Someone requested a password reset for your E.L.F.I.E. account.
              Click the button below to set a new password. This link expires in <strong style="color:#e2e8f0;">1 hour</strong>.
            </p>
            <a href="${resetUrl}"
               style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
              Reset Password
            </a>
            <p style="margin:24px 0 0;font-size:12px;color:#475569;">
              If you didn't request this, you can safely ignore this email. Your password won't change.
            </p>
            <p style="margin:12px 0 0;font-size:11px;color:#334155;word-break:break-all;">
              Or paste this link in your browser:<br/>
              <span style="color:#06b6d4;">${resetUrl}</span>
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[Email] Password reset sent to ${to}`);
  } catch (err) {
    console.error(`[Email] Failed to send password reset to ${to}:`, err);
    throw err;
  }
}

async function sendFeedbackFollowupEmail(
  to: string,
  buyerUsername: string,
  marketplace: string,
  orderTotal: string | null,
): Promise<void> {
  const total = orderTotal ? `$${parseFloat(orderTotal).toFixed(2)}` : null;
  const displayMarket = marketplace === 'BrickLink' ? 'BrickLink' : marketplace;
  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: `Thank you for your ${displayMarket} order!`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f172a;color:#e2e8f0;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#1B7CE5,#00FFEE);padding:24px 32px;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;">PlanetBrick</h1>
            <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Powered by E.L.F.I.E.</p>
          </div>
          <div style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;">Hi ${buyerUsername},</p>
            <p style="margin:0 0 20px;font-size:15px;color:#94a3b8;">
              Thank you for your${total ? ` <strong style="color:#e2e8f0;">${total}</strong>` : ''} order on ${displayMarket}!
              We hope everything arrived safely and in perfect condition.
            </p>
            <p style="margin:0 0 20px;font-size:15px;color:#94a3b8;">
              If you have any questions or concerns, feel free to reach out through ${displayMarket} messaging — we're happy to help.
            </p>
            <p style="margin:0;font-size:14px;color:#64748b;">
              We appreciate your support and look forward to your next order!
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[Email] Feedback follow-up sent to ${to} (${buyerUsername})`);
  } catch (err) {
    console.error(`[Email] Failed to send feedback follow-up to ${to}:`, err);
    throw err;
  }
}

export async function sendApprovalEmail(
  to: string,
  name: string,
  orgName: string,
  loginUrl: string
): Promise<void> {
  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: `You've been approved — welcome to ${orgName} on E.L.F.I.E.`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f172a;color:#e2e8f0;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#7c3aed,#ec4899,#06b6d4);padding:24px 32px;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;">E.L.F.I.E.</h1>
            <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">PlanetBrick Platform</p>
          </div>
          <div style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;">Hi ${name},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;">
              Great news — your account has been approved and you now have access to
              <strong style="color:#e2e8f0;">${orgName}</strong> on E.L.F.I.E.
            </p>
            <a href="${loginUrl}"
               style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
              Sign In Now
            </a>
            <p style="margin:24px 0 0;font-size:12px;color:#475569;">
              If you have any questions, reach out to your administrator.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[Email] Approval notification sent to ${to}`);
  } catch (err) {
    console.error(`[Email] Failed to send approval email to ${to}:`, err);
    throw err;
  }
}
