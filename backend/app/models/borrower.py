from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, new_uuid, utcnow
from app.models.enums import BorrowerType


class Borrower(TimestampMixin, Base):
    __tablename__ = "borrowers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lender_id: Mapped[str] = mapped_column(ForeignKey("lenders.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[str] = mapped_column(ForeignKey("branches.id", ondelete="RESTRICT"))
    officer_id: Mapped[str] = mapped_column(ForeignKey("staff.id", ondelete="RESTRICT"))
    type: Mapped[BorrowerType] = mapped_column(Enum(BorrowerType, native_enum=False, length=20))

    full_name: Mapped[str] = mapped_column(String(200))
    business_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    registration_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tax_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sector: Mapped[str | None] = mapped_column(String(150), nullable=True)
    years_trading: Mapped[int | None] = mapped_column(Integer, nullable=True)

    national_id: Mapped[str] = mapped_column(String(100), index=True)
    phone: Mapped[str] = mapped_column(String(50))
    residence: Mapped[str] = mapped_column(String(250), default="")
    occupation: Mapped[str] = mapped_column(String(150), default="")
    monthly_income: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    next_of_kin: Mapped[str] = mapped_column(String(200), default="")

    blacklisted: Mapped[bool] = mapped_column(Boolean, default=False)
    blacklist_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    guarantors: Mapped[list["Guarantor"]] = relationship(back_populates="borrower", cascade="all, delete-orphan")
    documents: Mapped[list["BorrowerDocument"]] = relationship(back_populates="borrower", cascade="all, delete-orphan")
    history: Mapped[list["BorrowerHistoryEvent"]] = relationship(
        back_populates="borrower", cascade="all, delete-orphan", order_by="BorrowerHistoryEvent.date"
    )


class Guarantor(Base):
    __tablename__ = "guarantors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    borrower_id: Mapped[str] = mapped_column(ForeignKey("borrowers.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    national_id: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(50))
    consent_given: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    borrower: Mapped["Borrower"] = relationship(back_populates="guarantors")


class BorrowerDocument(Base):
    __tablename__ = "borrower_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    borrower_id: Mapped[str] = mapped_column(ForeignKey("borrowers.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(100))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    borrower: Mapped["Borrower"] = relationship(back_populates="documents")


class BorrowerHistoryEvent(Base):
    __tablename__ = "borrower_history_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    borrower_id: Mapped[str] = mapped_column(ForeignKey("borrowers.id", ondelete="CASCADE"), index=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    label: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str] = mapped_column(Text, default="")

    borrower: Mapped["Borrower"] = relationship(back_populates="history")
