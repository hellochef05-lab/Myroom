import { createHash, randomUUID } from "node:crypto";

const ALERT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ALERT_LIMIT = 100;
const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

export function resolveAlertLocation({ countryCode, timezone }) {
  const code = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  const country = /^[A-Z]{2}$/.test(code) && code !== "ZZ" ? regionNames.of(code) || "" : "";
  let normalizedTimezone = "";
  if (typeof timezone === "string" && /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(timezone)) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      normalizedTimezone = timezone;
    } catch { /* Invalid time zones fall back to UTC in the dashboard. */ }
  }
  return { country, timezone: normalizedTimezone };
}

function alertText(value, excluded = [], maxLength = 80) {
  if (typeof value !== "string") return "";
  let text = value;
  for (const secret of excluded) {
    if (typeof secret === "string" && secret.trim()) {
      text = text.replaceAll(secret.trim(), "[redacted]");
    }
  }
  return text.replace(/\p{Cc}/gu, " ").trim().slice(0, maxLength);
}

function isRecent(event, now) {
  const time = Date.parse(event?.createdAt);
  return time >= now - ALERT_AGE_MS && time <= now;
}

export function recordLoginAttempt(db, { displayName, roomCode, accessKey, allowed, countryCode, timezone }, now = Date.now()) {
  const excluded = [accessKey];
  const entries = db.accessLoginAlerts ||= [];
  const recent = entries.filter(event => isRecent(event, now)).slice(-(ALERT_LIMIT - 1));
  entries.splice(0, entries.length, ...recent, {
    id: randomUUID(),
    type: "login",
    displayName: alertText(displayName, excluded) || "Guest",
    roomCode: alertText(roomCode, excluded, 32),
    allowed: allowed === true,
    ...resolveAlertLocation({ countryCode, timezone }),
    createdAt: new Date(now).toISOString(),
  });
}

export function recentAccessAlerts(db, now = Date.now()) {
  const logins = (db.accessLoginAlerts || []).filter(event => isRecent(event, now));
  // Sign-up requests already exist in the payment review queue. Project only
  // the allowed fields so alert history never duplicates payment credentials.
  const signups = db.payments.filter(payment => isRecent(payment, now)).map(payment => {
    const excluded = [payment.upiReference, payment.accessKey];
    return {
      id: `signup:${createHash("sha256").update(String(payment.id)).digest("base64url").slice(0, 20)}`,
      type: "signup",
      displayName: alertText(payment.username, excluded) || "Guest",
      contact: alertText(payment.contact, excluded, 150),
      planName: alertText(payment.planName, excluded),
      country: payment.alertLocation?.country || "",
      timezone: payment.alertLocation?.timezone || "",
      createdAt: payment.createdAt,
    };
  });
  return [...logins, ...signups]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, ALERT_LIMIT);
}
