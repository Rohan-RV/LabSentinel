/**
 * Email alerting. Sends a proactive notification the moment a device's health
 * drops below the configured threshold (default 80). Uses nodemailer over SMTP
 * (a Gmail App Password works out of the box). If SMTP credentials are absent
 * the mailer is a graceful no-op so the demo never breaks; it just logs the
 * alert it would have sent.
 */
import nodemailer from "nodemailer";
import { config } from "../config.js";

let transporter = null;
let ready = false;

function init() {
  const { smtpUser, smtpPass, smtpHost, smtpPort } = config.mail;
  if (!smtpUser || !smtpPass) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
  return transporter;
}

export async function verifyMailer() {
  const t = init();
  if (!t) {
    console.warn(
      "[mail] SMTP not configured (SMTP_USER / SMTP_PASS empty). " +
        "Health-alert emails are disabled; alerts will be logged only."
    );
    return false;
  }
  try {
    await t.verify();
    ready = true;
    console.log(
      `[mail] SMTP ready as ${config.mail.smtpUser}; alerts -> ${config.mail.alertTo.join(", ")}`
    );
  } catch (err) {
    ready = false;
    console.warn(`[mail] SMTP verify failed (${err.message}); alerts will be logged only.`);
  }
  return ready;
}

export function mailReady() {
  return ready;
}

function fmtRulEmail(rul) {
  if (!rul || rul.status === "warming_up") return "collecting readings";
  if (rul.status === "imminent") return "failure imminent (critical regime)";
  if (rul.status === "declining") {
    const sec = rul.eta_seconds;
    return `about ${sec >= 90 ? Math.round(sec / 60) + " min" : sec + " s"} to Critical (projection)`;
  }
  return "no degradation trend, device stable";
}

function buildBody(d) {
  const risk = Math.round((d.risk ?? 0) * 100);
  const subject = `[LabSentinel] ${d.status} - ${d.id} health ${d.health}% (${d.type}, ${d.location})`;
  const text =
    `LabSentinel proactive maintenance alert\n\n` +
    `Device:       ${d.id} (${d.type})\n` +
    `Location:     ${d.location}\n` +
    `Health:       ${d.health}%   (alert threshold ${config.mail.threshold}%)\n` +
    `Failure risk: ${risk}%\n` +
    `Status:       ${d.status}\n` +
    `Priority:     HIGH\n` +
    `Reason:       ${d.reason}\n` +
    `Est. life:    ${fmtRulEmail(d.rul)}\n` +
    `RUL model:    XGBoost on NASA C-MAPSS, RMSE 18.89 cycles\n` +
    `Time:         ${d.timestamp}\n\n` +
    `This is an automated notification from the LabSentinel fleet monitor.\n` +
    `The full diagnostic report is attached as a PDF. Open the dashboard for the live view.`;
  return { subject, text };
}

export async function sendHealthAlert(d) {
  const t = init();
  const { subject, text } = buildBody(d);
  if (!t) {
    console.log(`[mail] (disabled) would alert on ${d.id}: ${subject}`);
    return false;
  }
  try {
    const attachments = d.report && d.report.pdf
      ? [{ filename: d.report.filename || `LabSentinel_${d.id}_report.pdf`, content: d.report.pdf, contentType: "application/pdf" }]
      : [];
    await t.sendMail({
      from: `LabSentinel <${config.mail.smtpUser}>`,
      to: config.mail.alertTo.join(", "),
      subject,
      text,
      attachments,
    });
    console.log(`[mail] sent health alert for ${d.id} to ${config.mail.alertTo.join(", ")}`);
    return true;
  } catch (err) {
    console.warn(`[mail] failed to send alert for ${d.id}: ${err.message}`);
    return false;
  }
}
