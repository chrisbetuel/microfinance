"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-08-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_UUID = sa.String(length=36)
_TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "lenders",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("licence_number", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("licence_expiry", sa.Date(), nullable=True),
        sa.Column("address", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("phone", sa.String(length=50), nullable=False, server_default=""),
        sa.Column("email", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("logo_initials", sa.String(length=3), nullable=False, server_default=""),
        sa.Column("brand_color", sa.String(length=7), nullable=False, server_default="#4F46E5"),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="TZS"),
        sa.Column("language", sa.String(length=2), nullable=False, server_default="sw"),
        sa.Column("plan_level", sa.String(length=20), nullable=False, server_default="starter"),
        sa.Column("staff_limit", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("active_loan_limit", sa.Integer(), nullable=False, server_default="500"),
        sa.Column("sms_balance", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sms_sender_name", sa.String(length=11), nullable=False, server_default=""),
        sa.Column("sms_sender_approved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", _TS, nullable=False),
    )

    op.create_table(
        "branches",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("lender_id", _UUID, nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("location", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("opened_on", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(["lender_id"], ["lenders.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_branches_lender_id", "branches", ["lender_id"])

    op.create_table(
        "staff",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("lender_id", _UUID, nullable=False),
        sa.Column("branch_id", _UUID, nullable=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("email", sa.String(length=200), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=False),
        sa.Column("approval_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("phone", sa.String(length=50), nullable=False, server_default=""),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.ForeignKeyConstraint(["lender_id"], ["lenders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_staff_lender_id", "staff", ["lender_id"])
    op.create_index("ix_staff_email", "staff", ["email"], unique=True)

    op.create_table(
        "holidays",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("lender_id", _UUID, nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.ForeignKeyConstraint(["lender_id"], ["lenders.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_holidays_lender_id", "holidays", ["lender_id"])

    op.create_table(
        "borrowers",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("lender_id", _UUID, nullable=False),
        sa.Column("branch_id", _UUID, nullable=False),
        sa.Column("officer_id", _UUID, nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("full_name", sa.String(length=200), nullable=False),
        sa.Column("business_name", sa.String(length=200), nullable=True),
        sa.Column("registration_number", sa.String(length=100), nullable=True),
        sa.Column("tax_id", sa.String(length=100), nullable=True),
        sa.Column("sector", sa.String(length=150), nullable=True),
        sa.Column("years_trading", sa.Integer(), nullable=True),
        sa.Column("national_id", sa.String(length=100), nullable=False),
        sa.Column("phone", sa.String(length=50), nullable=False),
        sa.Column("residence", sa.String(length=250), nullable=False, server_default=""),
        sa.Column("occupation", sa.String(length=150), nullable=False, server_default=""),
        sa.Column("monthly_income", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("next_of_kin", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("blacklisted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("blacklist_reason", sa.Text(), nullable=True),
        sa.Column("created_at", _TS, nullable=False),
        sa.ForeignKeyConstraint(["lender_id"], ["lenders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["officer_id"], ["staff.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_borrowers_lender_id", "borrowers", ["lender_id"])
    op.create_index("ix_borrowers_national_id", "borrowers", ["national_id"])

    op.create_table(
        "guarantors",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("borrower_id", _UUID, nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("national_id", sa.String(length=100), nullable=False),
        sa.Column("phone", sa.String(length=50), nullable=False),
        sa.Column("consent_given", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("consent_date", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["borrower_id"], ["borrowers.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_guarantors_borrower_id", "guarantors", ["borrower_id"])

    op.create_table(
        "borrower_documents",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("borrower_id", _UUID, nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("type", sa.String(length=100), nullable=False),
        sa.Column("uploaded_at", _TS, nullable=False),
        sa.ForeignKeyConstraint(["borrower_id"], ["borrowers.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_borrower_documents_borrower_id", "borrower_documents", ["borrower_id"])

    op.create_table(
        "borrower_history_events",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("borrower_id", _UUID, nullable=False),
        sa.Column("date", _TS, nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["borrower_id"], ["borrowers.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_borrower_history_events_borrower_id", "borrower_history_events", ["borrower_id"])

    op.create_table(
        "loan_products",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("lender_id", _UUID, nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("interest_method", sa.String(length=20), nullable=False),
        sa.Column("interest_rate", sa.Numeric(6, 3), nullable=False),
        sa.Column("interest_period", sa.String(length=20), nullable=False),
        sa.Column("repayment_frequency", sa.String(length=20), nullable=False),
        sa.Column("min_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("max_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("min_term_instalments", sa.Integer(), nullable=False),
        sa.Column("max_term_instalments", sa.Integer(), nullable=False),
        sa.Column("step_up_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("grace_period_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("grace_period_applies_to", sa.String(length=20), nullable=False, server_default="none"),
        sa.Column("penalty_kind", sa.String(length=10), nullable=False),
        sa.Column("penalty_value", sa.Numeric(10, 2), nullable=False),
        sa.Column("penalty_cap", sa.Numeric(14, 2), nullable=False),
        sa.Column("allocation_order", sa.JSON(), nullable=False),
        sa.Column("security_required", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["lender_id"], ["lenders.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_loan_products_lender_id", "loan_products", ["lender_id"])

    op.create_table(
        "product_fees",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("product_id", _UUID, nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("value", sa.Numeric(10, 2), nullable=False),
        sa.Column("timing", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["loan_products.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_product_fees_product_id", "product_fees", ["product_id"])

    op.create_table(
        "approval_levels",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("product_id", _UUID, nullable=False),
        sa.Column("min_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("max_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("required_role", sa.String(length=30), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["loan_products.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_approval_levels_product_id", "approval_levels", ["product_id"])

    op.create_table(
        "applications",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("lender_id", _UUID, nullable=False),
        sa.Column("branch_id", _UUID, nullable=False),
        sa.Column("reference", sa.String(length=30), nullable=False),
        sa.Column("borrower_id", _UUID, nullable=False),
        sa.Column("product_id", _UUID, nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("term_instalments", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending_approval"),
        sa.Column("declared_income", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("declared_expenses", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("affordability_pass", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("duplicate_check_pass", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("blacklist_check_pass", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("credit_bureau_consent", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("score_recommendation", sa.String(length=20), nullable=True),
        sa.Column("required_approver_role", sa.String(length=30), nullable=False),
        sa.Column("created_by", _UUID, nullable=False),
        sa.Column("decline_reason", sa.Text(), nullable=True),
        sa.Column("created_at", _TS, nullable=False),
        sa.ForeignKeyConstraint(["lender_id"], ["lenders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["borrower_id"], ["borrowers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["loan_products.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["staff.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_applications_lender_id", "applications", ["lender_id"])
    op.create_index("ix_applications_reference", "applications", ["reference"])
    op.create_index("ix_applications_borrower_id", "applications", ["borrower_id"])

    op.create_table(
        "approval_decisions",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("application_id", _UUID, nullable=False),
        sa.Column("approver_id", _UUID, nullable=False),
        sa.Column("approver_name", sa.String(length=150), nullable=False, server_default=""),
        sa.Column("role", sa.String(length=30), nullable=False),
        sa.Column("decision", sa.String(length=20), nullable=False),
        sa.Column("date", _TS, nullable=False),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["approver_id"], ["staff.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_approval_decisions_application_id", "approval_decisions", ["application_id"])

    op.create_table(
        "loans",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("lender_id", _UUID, nullable=False),
        sa.Column("branch_id", _UUID, nullable=False),
        sa.Column("application_id", _UUID, nullable=False, unique=True),
        sa.Column("borrower_id", _UUID, nullable=False),
        sa.Column("product_id", _UUID, nullable=False),
        sa.Column("principal", sa.Numeric(14, 2), nullable=False),
        sa.Column("net_disbursed", sa.Numeric(14, 2), nullable=False),
        sa.Column("fees_deducted", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=25), nullable=False, server_default="active"),
        sa.Column("outstanding_balance", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("disbursement_channel", sa.String(length=20), nullable=False),
        sa.Column("disbursement_date", _TS, nullable=False),
        sa.Column("disbursement_reference", sa.String(length=100), nullable=False),
        sa.Column("disbursement_approved_by", sa.String(length=150), nullable=False),
        sa.Column("disbursement_disbursed_by", sa.String(length=150), nullable=False),
        sa.Column("created_at", _TS, nullable=False),
        sa.ForeignKeyConstraint(["lender_id"], ["lenders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["borrower_id"], ["borrowers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["loan_products.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_loans_lender_id", "loans", ["lender_id"])
    op.create_index("ix_loans_borrower_id", "loans", ["borrower_id"])

    op.create_table(
        "schedule_instalments",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("loan_id", _UUID, nullable=False),
        sa.Column("period", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("principal_due", sa.Numeric(14, 2), nullable=False),
        sa.Column("interest_due", sa.Numeric(14, 2), nullable=False),
        sa.Column("fees_due", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("penalty_due", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("total_due", sa.Numeric(14, 2), nullable=False),
        sa.Column("paid_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("balance_after", sa.Numeric(14, 2), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="upcoming"),
        sa.ForeignKeyConstraint(["loan_id"], ["loans.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_schedule_instalments_loan_id", "schedule_instalments", ["loan_id"])

    op.create_table(
        "repayments",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("lender_id", _UUID, nullable=False),
        sa.Column("loan_id", _UUID, nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("date", _TS, nullable=False),
        sa.Column("channel", sa.String(length=20), nullable=False),
        sa.Column("receipt_number", sa.String(length=30), nullable=False),
        sa.Column("allocation_penalty", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("allocation_fees", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("allocation_interest", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("allocation_principal", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("recorded_by", sa.String(length=150), nullable=False),
        sa.Column("reversed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reversal_reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["lender_id"], ["lenders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["loan_id"], ["loans.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_repayments_lender_id", "repayments", ["lender_id"])
    op.create_index("ix_repayments_loan_id", "repayments", ["loan_id"])
    op.create_index("ix_repayments_receipt_number", "repayments", ["receipt_number"])

    op.create_table(
        "audit_log_entries",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("lender_id", _UUID, nullable=False),
        sa.Column("timestamp", _TS, nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.Column("user_name", sa.String(length=150), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("entity", sa.String(length=50), nullable=False),
        sa.Column("entity_id", _UUID, nullable=False),
        sa.Column("details", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["lender_id"], ["lenders.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_audit_log_entries_lender_id", "audit_log_entries", ["lender_id"])


def downgrade() -> None:
    for table in (
        "audit_log_entries",
        "repayments",
        "schedule_instalments",
        "loans",
        "approval_decisions",
        "applications",
        "approval_levels",
        "product_fees",
        "loan_products",
        "borrower_history_events",
        "borrower_documents",
        "guarantors",
        "borrowers",
        "holidays",
        "staff",
        "branches",
        "lenders",
    ):
        op.drop_table(table)
