from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, new_uuid, utcnow
from app.models.enums import ApplicationStatus, ApprovalDecisionType, ScoreRecommendation, StaffRole


class Application(TimestampMixin, Base):
    __tablename__ = "applications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lender_id: Mapped[str] = mapped_column(ForeignKey("lenders.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[str] = mapped_column(ForeignKey("branches.id", ondelete="RESTRICT"))
    reference: Mapped[str] = mapped_column(String(30), index=True)

    borrower_id: Mapped[str] = mapped_column(ForeignKey("borrowers.id", ondelete="RESTRICT"), index=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("loan_products.id", ondelete="RESTRICT"))

    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    term_instalments: Mapped[int] = mapped_column(Integer)
    purpose: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[ApplicationStatus] = mapped_column(
        Enum(ApplicationStatus, native_enum=False, length=20), default=ApplicationStatus.pending_approval
    )

    declared_income: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    declared_expenses: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    affordability_pass: Mapped[bool] = mapped_column(Boolean, default=True)
    duplicate_check_pass: Mapped[bool] = mapped_column(Boolean, default=True)
    blacklist_check_pass: Mapped[bool] = mapped_column(Boolean, default=True)
    credit_bureau_consent: Mapped[bool] = mapped_column(Boolean, default=False)

    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score_recommendation: Mapped[ScoreRecommendation | None] = mapped_column(
        Enum(ScoreRecommendation, native_enum=False, length=20), nullable=True
    )

    required_approver_role: Mapped[StaffRole] = mapped_column(Enum(StaffRole, native_enum=False, length=30))
    created_by: Mapped[str] = mapped_column(ForeignKey("staff.id", ondelete="RESTRICT"))
    decline_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    approvals: Mapped[list["ApprovalDecision"]] = relationship(
        back_populates="application", cascade="all, delete-orphan", order_by="ApprovalDecision.date"
    )


class ApprovalDecision(Base):
    __tablename__ = "approval_decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    approver_id: Mapped[str] = mapped_column(ForeignKey("staff.id", ondelete="RESTRICT"))
    approver_name: Mapped[str] = mapped_column(String(150), default="")
    role: Mapped[StaffRole] = mapped_column(Enum(StaffRole, native_enum=False, length=30))
    decision: Mapped[ApprovalDecisionType] = mapped_column(Enum(ApprovalDecisionType, native_enum=False, length=20))
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    comment: Mapped[str] = mapped_column(Text, default="")

    application: Mapped["Application"] = relationship(back_populates="approvals")
