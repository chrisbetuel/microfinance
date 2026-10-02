"""Mobile-money / payment gateway abstraction.

Two operations, both asynchronous like every real mobile-money API:

* collect(phone, amount, reference)  — ask the customer to pay (STK / USSD push)
* payout(phone, amount, reference)   — send money to the customer

Each returns a provider reference immediately; the final result arrives
later on the webhook (POST /payments/callback), which settles the
PaymentTransaction. The "mock" provider never touches a network — staff can
confirm or fail a pending transaction from the UI to simulate the callback.

To go live, implement a provider class for your aggregator (Selcom, AzamPay,
M-Pesa Daraja/Open API, Tigo Pesa, Airtel Money…), register it in PROVIDERS
and set LMS_PAYMENT_PROVIDER + LMS_PAYMENT_API_KEY + LMS_PAYMENT_WEBHOOK_SECRET.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from django.conf import settings


@dataclass
class GatewayResult:
    accepted: bool
    provider_ref: str = ""
    error: str = ""


class PaymentProvider:
    name = "base"
    simulated = True

    def collect(self, phone: str, amount: float, reference: str, network: str) -> GatewayResult:  # pragma: no cover
        raise NotImplementedError

    def payout(self, phone: str, amount: float, reference: str, network: str) -> GatewayResult:  # pragma: no cover
        raise NotImplementedError


class MockGateway(PaymentProvider):
    name = "mock"

    def collect(self, phone, amount, reference, network):
        return GatewayResult(accepted=True, provider_ref=f"MOCK-C-{uuid.uuid4().hex[:10].upper()}")

    def payout(self, phone, amount, reference, network):
        return GatewayResult(accepted=True, provider_ref=f"MOCK-P-{uuid.uuid4().hex[:10].upper()}")


class HttpPaymentGateway(PaymentProvider):
    """Template for a real aggregator — fill in the vendor calls."""

    name = "http"
    simulated = False

    def _check(self):
        if not settings.LMS_PAYMENT_API_KEY:
            return GatewayResult(accepted=False, error="Payment gateway not configured (LMS_PAYMENT_API_KEY missing)")
        return None

    def collect(self, phone, amount, reference, network):
        return self._check() or (_ for _ in ()).throw(NotImplementedError("Implement the collection call"))

    def payout(self, phone, amount, reference, network):
        return self._check() or (_ for _ in ()).throw(NotImplementedError("Implement the payout call"))


PROVIDERS: dict[str, type[PaymentProvider]] = {"mock": MockGateway, "http": HttpPaymentGateway}


def get_provider() -> PaymentProvider:
    return PROVIDERS.get(getattr(settings, "LMS_PAYMENT_PROVIDER", "mock"), MockGateway)()
