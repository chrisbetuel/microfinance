from datetime import date

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, new_uuid


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lender_id: Mapped[str] = mapped_column(ForeignKey("lenders.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    code: Mapped[str] = mapped_column(String(20))
    location: Mapped[str] = mapped_column(String(200), default="")
    opened_on: Mapped[date] = mapped_column(Date)

    lender: Mapped["Lender"] = relationship(back_populates="branches")
