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


PROVIDERS: dict[str, type[SmsProvider]] = {
    "console": ConsoleSms,
    "mock": ConsoleSms,
    "logging": LoggingSms,
    "noop": NoopSms,
    "http": HttpSmsGateway,
}


def get_provider() -> SmsProvider:
    return PROVIDERS.get(getattr(settings, "LMS_SMS_PROVIDER", "console"), ConsoleSms)()


def segments(body: str) -> int:
    """Billable SMS parts (GSM-7: 160 single / 153 per concatenated part)."""
    n = len(body)
    return 1 if n <= 160 else -(-n // 153)
