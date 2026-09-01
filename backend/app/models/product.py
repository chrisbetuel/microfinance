from sqlalchemy import JSON, Boolean, Enum, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, new_uuid
from app.models.enums import (
    FeeTiming,
    GracePeriodAppliesTo,
    InterestMethod,
    InterestPeriod,
    RepaymentFrequency,
    StaffRole,
)


class LoanProduct(Base):
    __tablename__ = "loan_products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lender_id: Mapped[str] = mapped_column(ForeignKey("lenders.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    code: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    interest_method: Mapped[InterestMethod] = mapped_column(Enum(InterestMethod, native_enum=False, length=20))
    interest_rate: Mapped[float] = mapped_column(Numeric(6, 3))
    interest_period: Mapped[InterestPeriod] = mapped_column(Enum(InterestPeriod, native_enum=False, length=20))
    repayment_frequency: Mapped[RepaymentFrequency] = mapped_column(Enum(RepaymentFrequency, native_enum=False, length=20))

    min_amount: Mapped[float] = mapped_column(Numeric(14, 2))
    max_amount: Mapped[float] = mapped_column(Numeric(14, 2))
    min_term_instalments: Mapped[int] = mapped_column(Integer)
    max_term_instalments: Mapped[int] = mapped_column(Integer)
    step_up_enabled: Mapped[bool] = mapped_column(Boolean, default=False)

    grace_period_days: Mapped[int] = mapped_column(Integer, default=0)
    grace_period_applies_to: Mapped[GracePeriodAppliesTo] = mapped_column(
        Enum(GracePeriodAppliesTo, native_enum=False, length=20), default=GracePeriodAppliesTo.none
    )

    penalty_kind: Mapped[str] = mapped_column(String(10))  # 'fixed' | 'percent'
    penalty_value: Mapped[float] = mapped_column(Numeric(10, 2))
    penalty_cap: Mapped[float] = mapped_column(Numeric(14, 2))

    # Stored as ordered JSON lists so a lender can reorder/reconfigure without a schema change.
    allocation_order: Mapped[list[str]] = mapped_column(JSON, default=list)
    security_required: Mapped[list[str]] = mapped_column(JSON, default=list)

    fees: Mapped[list["ProductFee"]] = relationship(back_populates="product", cascade="all, delete-orphan")
    approval_levels: Mapped[list["ApprovalLevel"]] = relationship(
        back_populates="product", cascade="all, delete-orphan", order_by="ApprovalLevel.min_amount"
    )


class ProductFee(Base):
    __tablename__ = "product_fees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    product_id: Mapped[str] = mapped_column(ForeignKey("loan_products.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    kind: Mapped[str] = mapped_column(String(10))  # 'fixed' | 'percent'
    value: Mapped[float] = mapped_column(Numeric(10, 2))
    timing: Mapped[FeeTiming] = mapped_column(Enum(FeeTiming, native_enum=False, length=20))

    product: Mapped["LoanProduct"] = relationship(back_populates="fees")


class ApprovalLevel(Base):
    __tablename__ = "approval_levels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    product_id: Mapped[str] = mapped_column(ForeignKey("loan_products.id", ondelete="CASCADE"), index=True)
    min_amount: Mapped[float] = mapped_column(Numeric(14, 2))
    max_amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    required_role: Mapped[StaffRole] = mapped_column(Enum(StaffRole, native_enum=False, length=30))

    product: Mapped["LoanProduct"] = relationship(back_populates="approval_levels")
