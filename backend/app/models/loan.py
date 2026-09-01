from datetime import date, datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, new_uuid
from app.models.enums import DisbursementChannel, InstalmentStatus, LoanStatus


class Loan(TimestampMixin, Base):
    __tablename__ = "loans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lender_id: Mapped[str] = mapped_column(ForeignKey("lenders.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[str] = mapped_column(ForeignKey("branches.id", ondelete="RESTRICT"))
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="RESTRICT"), unique=True)
    borrower_id: Mapped[str] = mapped_column(ForeignKey("borrowers.id", ondelete="RESTRICT"), index=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("loan_products.id", ondelete="RESTRICT"))

    principal: Mapped[float] = mapped_column(Numeric(14, 2))
    net_disbursed: Mapped[float] = mapped_column(Numeric(14, 2))
    fees_deducted: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    status: Mapped[LoanStatus] = mapped_column(Enum(LoanStatus, native_enum=False, length=25), default=LoanStatus.active)
    outstanding_balance: Mapped[float] = mapped_column(Numeric(14, 2), default=0)

    # Disbursement is 1:1 with the loan (a loan row is only ever created once funds actually move).
    disbursement_channel: Mapped[DisbursementChannel] = mapped_column(Enum(DisbursementChannel, native_enum=False, length=20))
    disbursement_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    disbursement_reference: Mapped[str] = mapped_column(String(100))
    disbursement_approved_by: Mapped[str] = mapped_column(String(150))
    disbursement_disbursed_by: Mapped[str] = mapped_column(String(150))

    schedule: Mapped[list["ScheduleInstalment"]] = relationship(
        back_populates="loan", cascade="all, delete-orphan", order_by="ScheduleInstalment.period"
    )

    @property
    def disbursement(self) -> dict | None:
        """The frontend models disbursement as a nested object on the loan.

        A loan row only ever exists once funds have moved, so this is always set.
        """
        if self.disbursement_date is None:
            return None
        return {
            "channel": self.disbursement_channel,
            "date": self.disbursement_date,
            "reference": self.disbursement_reference,
            "approved_by": self.disbursement_approved_by,
            "disbursed_by": self.disbursement_disbursed_by,
        }


class ScheduleInstalment(Base):
    __tablename__ = "schedule_instalments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    loan_id: Mapped[str] = mapped_column(ForeignKey("loans.id", ondelete="CASCADE"), index=True)
    period: Mapped[int] = mapped_column(Integer)
    due_date: Mapped[date] = mapped_column()
    principal_due: Mapped[float] = mapped_column(Numeric(14, 2))
    interest_due: Mapped[float] = mapped_column(Numeric(14, 2))
    fees_due: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    penalty_due: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    total_due: Mapped[float] = mapped_column(Numeric(14, 2))
    paid_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    balance_after: Mapped[float] = mapped_column(Numeric(14, 2))
    status: Mapped[InstalmentStatus] = mapped_column(Enum(InstalmentStatus, native_enum=False, length=20), default=InstalmentStatus.upcoming)

    loan: Mapped["Loan"] = relationship(back_populates="schedule")
