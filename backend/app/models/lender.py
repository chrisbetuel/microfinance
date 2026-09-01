from datetime import date

from sqlalchemy import Date, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, new_uuid


class Lender(TimestampMixin, Base):
    __tablename__ = "lenders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(200))
    licence_number: Mapped[str] = mapped_column(String(100), default="")
    licence_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    address: Mapped[str] = mapped_column(String(300), default="")
    phone: Mapped[str] = mapped_column(String(50), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    logo_initials: Mapped[str] = mapped_column(String(3), default="")
    brand_color: Mapped[str] = mapped_column(String(7), default="#EE0033")
    currency: Mapped[str] = mapped_column(String(10), default="TZS")
    language: Mapped[str] = mapped_column(String(2), default="sw")
    plan_level: Mapped[str] = mapped_column(String(20), default="starter")
    staff_limit: Mapped[int] = mapped_column(Integer, default=10)
    active_loan_limit: Mapped[int] = mapped_column(Integer, default=500)
    sms_balance: Mapped[int] = mapped_column(Integer, default=0)
    sms_sender_name: Mapped[str] = mapped_column(String(11), default="")
    sms_sender_approved: Mapped[bool] = mapped_column(default=False)

    branches: Mapped[list["Branch"]] = relationship(back_populates="lender", cascade="all, delete-orphan")
    staff: Mapped[list["Staff"]] = relationship(back_populates="lender", cascade="all, delete-orphan")
    holidays: Mapped[list["Holiday"]] = relationship(back_populates="lender", cascade="all, delete-orphan")
