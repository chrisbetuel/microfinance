"""SMS gateway abstraction.

Every outbound SMS goes through `get_provider().send(...)`. Today the
configured provider is "console" (prints) or "mock"; to go live, implement a
class with the same `send` signature for your gateway (Africa's Talking,
Beem, NextSMS, Twilio…), register it in PROVIDERS and set LMS_SMS_PROVIDER.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from django.conf import settings

log = logging.getLogger("lms.sms")


@dataclass
class SmsResult:
    ok: bool
    provider_ref: str = ""
    error: str = ""


class SmsProvider:
    name = "base"
    #: True when no real network call is made (UI can say so)
    simulated = True

    def send(self, to: str, body: str, sender_id: str = "") -> SmsResult:  # pragma: no cover - interface
        raise NotImplementedError


class ConsoleSms(SmsProvider):
    name = "console"

    def send(self, to, body, sender_id=""):
        print(f"[sms{(':' + sender_id) if sender_id else ''}] -> {to}: {body}")
        return SmsResult(ok=True, provider_ref="console")


class LoggingSms(SmsProvider):
    name = "logging"

    def send(self, to, body, sender_id=""):
        log.info("sms -> %s: %s", to, body)
        return SmsResult(ok=True, provider_ref="log")


class NoopSms(SmsProvider):
    name = "noop"

    def send(self, to, body, sender_id=""):
        return SmsResult(ok=True, provider_ref="noop")


class HttpSmsGateway(SmsProvider):
    """Template for a real gateway. Fill in `send` with the vendor's HTTP call
    using settings.LMS_SMS_API_KEY / LMS_SMS_SENDER_ID."""

    name = "http"
    simulated = False

    def send(self, to, body, sender_id=""):
        if not settings.LMS_SMS_API_KEY:
            return SmsResult(ok=False, error="SMS gateway not configured (LMS_SMS_API_KEY missing)")
        raise NotImplementedError("Implement the vendor API call here")


def msisdn(phone: str) -> str:
    """Tanzanian number in international form without '+': '0712 345 678' → '255712345678'."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if digits.startswith("255"):
        return digits
    if digits.startswith("0"):
        return "255" + digits[1:]
    return "255" + digits if len(digits) == 9 else digits


class HaflawaySms(SmsProvider):
    """Haflaway / SMTZ bulk SMS (https://messaging.haflaway.com).

    API reference: GET {LMS_SMS_BASE_URL}/openapi.json. A message is sent as a
    one-recipient campaign: POST /campaigns with Bearer API key (smtz_…), an
    approved sender ID, the text and the MSISDN. The campaign id comes back as
    the provider reference; delivery reports arrive on /sms/haflaway/webhook.
    """

    name = "haflaway"
    simulated = False

    def send(self, to, body, sender_id=""):
        import json
        import urllib.error
        import urllib.request
        import uuid

        key = settings.LMS_SMS_API_KEY
        sender = sender_id or settings.LMS_SMS_SENDER_ID
        if not key:
            return SmsResult(ok=False, error="Haflaway SMS not configured (LMS_SMS_API_KEY missing)")
        if not sender:
            return SmsResult(ok=False, error="Haflaway SMS needs an approved sender ID (LMS_SMS_SENDER_ID)")
        allowed = {msisdn(n) for n in settings.LMS_SMS_ALLOWED_NUMBERS.split(",") if n.strip()}
        if allowed and msisdn(to) not in allowed:
            return SmsResult(ok=False, error="Not sent: test mode — number not in LMS_SMS_ALLOWED_NUMBERS")
        payload = json.dumps({
            "name": "LMS notification", "senderId": sender[:11], "content": body[:1600], "recipients": [msisdn(to)],
        }).encode()
        req = urllib.request.Request(
            f"{settings.LMS_SMS_BASE_URL.rstrip('/')}/campaigns", data=payload, method="POST",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                     "Idempotency-Key": str(uuid.uuid4())},
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read() or b"{}")
            return SmsResult(ok=True, provider_ref=str(data.get("id", "")))
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read() or b"{}").get("message", "")
            except ValueError:
                detail = ""
            log.warning("haflaway sms rejected (%s): %s", exc.code, detail)
            return SmsResult(ok=False, error=f"Haflaway {exc.code}: {detail or exc.reason}"[:250])
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            log.warning("haflaway sms unreachable: %s", exc)
            return SmsResult(ok=False, error=f"Haflaway unreachable: {exc}"[:250])


def verify_haflaway_signature(header: str, raw_body: bytes, secret: str, tolerance: int = 300) -> bool:
    """`Smtz-Signature: t=<unix>,v1=<hex>` — HMAC-SHA256 of "<t>.<body>" (Stripe convention)."""
    import hashlib
    import hmac
    import time

    if not secret or not header:
        return False
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    stamp, sig = parts.get("t", ""), parts.get("v1", "")
    if not stamp.isdigit() or not sig or abs(time.time() - int(stamp)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{stamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


PROVIDERS: dict[str, type[SmsProvider]] = {
    "console": ConsoleSms,
    "mock": ConsoleSms,
    "logging": LoggingSms,
    "noop": NoopSms,
    "http": HttpSmsGateway,
    "haflaway": HaflawaySms,
}


def get_provider() -> SmsProvider:
    return PROVIDERS.get(getattr(settings, "LMS_SMS_PROVIDER", "console"), ConsoleSms)()


def segments(body: str) -> int:
    """Billable SMS parts (GSM-7: 160 single / 153 per concatenated part)."""
    n = len(body)
    return 1 if n <= 160 else -(-n // 153)
