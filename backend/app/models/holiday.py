from datetime import date

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, new_uuid


class Holiday(Base):
    __tablename__ = "holidays"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lender_id: Mapped[str] = mapped_column(ForeignKey("lenders.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date)
    name: Mapped[str] = mapped_column(String(150))

    lender: Mapped["Lender"] = relationship(back_populates="holidays")
