from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, new_uuid, utcnow
from app.models.enums import RepaymentChannel


class Repayment(Base):
    __tablename__ = "repayments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lender_id: Mapped[str] = mapped_column(ForeignKey("lenders.id", ondelete="CASCADE"), index=True)
    loan_id: Mapped[str] = mapped_column(ForeignKey("loans.id", ondelete="CASCADE"), index=True)

    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    channel: Mapped[RepaymentChannel] = mapped_column(Enum(RepaymentChannel, native_enum=False, length=20))
    receipt_number: Mapped[str] = mapped_column(String(30), index=True)

    allocation_penalty: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    allocation_fees: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    allocation_interest: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    allocation_principal: Mapped[float] = mapped_column(Numeric(14, 2), default=0)

    recorded_by: Mapped[str] = mapped_column(String(150))
    reversed: Mapped[bool] = mapped_column(Boolean, default=False)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    loan: Mapped["Loan"] = relationship()

    @property
    def allocation(self) -> dict:
        return {
            "penalty": self.allocation_penalty,
            "fees": self.allocation_fees,
            "interest": self.allocation_interest,
            "principal": self.allocation_principal,
        }
