"""Haflaway SMS provider and its signed delivery reports (no real network calls)."""

import hashlib
import hmac
import io
import json
import time
import urllib.error

import pytest

from lms.integrations import sms
from lms.models import Lender
from lms.services import notify


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def haflaway(settings):
    settings.LMS_SMS_PROVIDER = "haflaway"
    settings.LMS_SMS_API_KEY = "smtz_test"
    settings.LMS_SMS_SENDER_ID = "SELE"
    settings.LMS_SMS_WEBHOOK_SECRET = "whsec_test"
    settings.LMS_SMS_ALLOWED_NUMBERS = ""
    return settings


def test_msisdn_normalisation():
    assert sms.msisdn("0712 345 678") == "255712345678"
    assert sms.msisdn("+255 618 750 312") == "255618750312"
    assert sms.msisdn("712345678") == "255712345678"


def test_send_posts_a_campaign(haflaway, monkeypatch):
    seen = {}

    def fake_urlopen(req, timeout):
        seen["url"], seen["headers"], seen["body"] = req.full_url, dict(req.headers), json.loads(req.data)
        return FakeResponse(json.dumps({"id": "cmp_123", "status": "pending", "totalRecipients": 1}).encode())

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = sms.get_provider().send("0712 345 678", "Habari", "")
    assert result.ok and result.provider_ref == "cmp_123"
    assert seen["url"] == "https://messaging-api.haflaway.com/api/v1/campaigns"
    assert seen["headers"]["Authorization"] == "Bearer smtz_test"
    assert seen["body"] == {"name": "LMS notification", "senderId": "SELE", "content": "Habari", "recipients": ["255712345678"]}


def test_send_reports_gateway_errors(haflaway, monkeypatch):
    def fake_urlopen(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 402, "Payment Required", {}, io.BytesIO(b'{"message":"Insufficient balance"}'))

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = sms.get_provider().send("0712345678", "x")
    assert not result.ok and "Insufficient balance" in result.error
    haflaway.LMS_SMS_API_KEY = ""
    assert "not configured" in sms.get_provider().send("0712345678", "x").error


def _signed(body: bytes, secret="whsec_test", ts=None):
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


def test_delivery_report_updates_the_message(haflaway, admin, client, monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen",
                        lambda req, timeout: FakeResponse(b'{"id":"cmp_9","status":"pending","totalRecipients":1}'))
    lender = Lender.objects.get(name="Test Microfinance")  # created by the admin fixture
    note = notify.send(lender, to="0712345678", kind="manual", body="Test")
    assert note.status == "sent" and note.provider_ref == "cmp_9"

    body = json.dumps({"event": "message_delivered", "messageId": "m1", "campaignId": "cmp_9",
                       "msisdn": "255712345678", "status": "DELIVRD", "timestamp": "2026-10-03T08:00:00Z"}).encode()
    bad = client.post("/sms/haflaway/webhook", body, content_type="application/json", HTTP_SMTZ_SIGNATURE="t=1,v1=00")
    assert bad.status_code == 401
    stale = client.post("/sms/haflaway/webhook", body, content_type="application/json",
                        HTTP_SMTZ_SIGNATURE=_signed(body, ts=int(time.time()) - 3600))
    assert stale.status_code == 401
    ok = client.post("/sms/haflaway/webhook", body, content_type="application/json", HTTP_SMTZ_SIGNATURE=_signed(body))
    assert ok.status_code == 200 and ok.json()["updated"] == 1
    note.refresh_from_db()
    assert note.status == "delivered"


def test_test_mode_only_texts_allowed_numbers(haflaway, monkeypatch):
    calls = []
    monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout: calls.append(req) or FakeResponse(b'{"id":"c1"}'))
    haflaway.LMS_SMS_ALLOWED_NUMBERS = "0618750312"
    blocked = sms.get_provider().send("0712345678", "x")
    assert not blocked.ok and "test mode" in blocked.error and calls == []
    assert sms.get_provider().send("+255 618 750 312", "x").ok and len(calls) == 1
