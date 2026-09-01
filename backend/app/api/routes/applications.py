from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentStaff, DbSession, require_section_editor
from app.models import Application, ApprovalDecision, Borrower, Loan, LoanProduct, Staff
from app.models.enums import ApplicationStatus, ApprovalDecisionType
from app.schemas.application import (
    ApplicationCreateRequest,
    ApplicationDecisionRequest,
    ApplicationResponse,
)
from app.schemas.loan import DisburseRequest, LoanResponse
from app.services import applications as application_service
from app.services import audit, loans as loan_service
from app.services import permissions
from app.services.tenancy import ensure_branch

router = APIRouter(prefix="/applications", tags=["applications"])

ApplicationEditor = Annotated[Staff, Depends(require_section_editor("applications"))]
DisbursementEditor = Annotated[Staff, Depends(require_section_editor("disbursement"))]

_WITH_APPROVALS = (selectinload(Application.approvals),)


async def _get(db: DbSession, lender_id: str, application_id: str) -> Application:
    application = await db.scalar(
        select(Application).where(Application.id == application_id).options(*_WITH_APPROVALS)
    )
    if application is None or application.lender_id != lender_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return application


@router.get("", response_model=list[ApplicationResponse])
async def list_applications(staff: CurrentStaff, db: DbSession) -> list[Application]:
    result = await db.scalars(
        select(Application)
        .where(Application.lender_id == staff.lender_id)
        .options(*_WITH_APPROVALS)
        .order_by(Application.created_at.desc())
    )
    return list(result)


@router.get("/{application_id}", response_model=ApplicationResponse)
async def get_application(application_id: str, staff: CurrentStaff, db: DbSession) -> Application:
    return await _get(db, staff.lender_id, application_id)


@router.post("", response_model=ApplicationResponse, status_code=status.HTTP_201_CREATED)
async def create_application(
    body: ApplicationCreateRequest, staff: ApplicationEditor, db: DbSession
) -> Application:
    await ensure_branch(db, staff.lender_id, body.branch_id)
    borrower = await db.get(Borrower, body.borrower_id)
    if borrower is None or borrower.lender_id != staff.lender_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Borrower not found")
    if borrower.blacklisted:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Borrower is blacklisted")

    product = await db.scalar(
        select(LoanProduct)
        .where(LoanProduct.id == body.product_id)
        .options(selectinload(LoanProduct.approval_levels), selectinload(LoanProduct.fees))
    )
    if product is None or product.lender_id != staff.lender_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan product not found")
    if not product.active:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Loan product is not active")
    if not (float(product.min_amount) <= body.amount <= float(product.max_amount)):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Amount is outside the product range")
    if not (product.min_term_instalments <= body.term_instalments <= product.max_term_instalments):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Term is outside the product range")

    duplicates = await db.scalar(
        select(func.count())
        .select_from(Borrower)
        .where(Borrower.lender_id == staff.lender_id, Borrower.national_id == borrower.national_id)
    )
    assessment = application_service.assess(
        product=product,
        borrower=borrower,
        amount=body.amount,
        term_instalments=body.term_instalments,
        declared_income=body.declared_income,
        declared_expenses=body.declared_expenses,
        has_duplicate_national_id=(duplicates or 0) > 1,
    )

    application = Application(
        lender_id=staff.lender_id,
        branch_id=body.branch_id or borrower.branch_id,
        reference=await application_service.next_reference(db, staff.lender_id),
        borrower_id=borrower.id,
        product_id=product.id,
        amount=body.amount,
        term_instalments=body.term_instalments,
        purpose=body.purpose,
        status=ApplicationStatus.pending_approval,
        declared_income=body.declared_income,
        declared_expenses=body.declared_expenses,
        affordability_pass=assessment.affordability_pass,
        duplicate_check_pass=assessment.duplicate_check_pass,
        blacklist_check_pass=assessment.blacklist_check_pass,
        credit_bureau_consent=body.credit_bureau_consent,
        score=assessment.score,
        score_recommendation=assessment.score_recommendation,
        required_approver_role=assessment.required_approver_role,
        created_by=staff.id,
    )
    db.add(application)
    await db.flush()
    await audit.record(
        db, staff, "created", "application", application.id,
        f"Application {application.reference} submitted for {borrower.full_name}",
    )
    await db.commit()
    return await _get(db, staff.lender_id, application.id)


@router.post("/{application_id}/decision", response_model=ApplicationResponse)
async def decide_application(
    application_id: str, body: ApplicationDecisionRequest, staff: ApplicationEditor, db: DbSession
) -> Application:
    application = await _get(db, staff.lender_id, application_id)

    if application.status not in (ApplicationStatus.pending_approval, ApplicationStatus.submitted):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This application is no longer open for a decision")
    if application.created_by == staff.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You created this application — a different approver must decide it",
        )
    if not permissions.can_approve_application(staff.role, application.required_approver_role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This amount requires a {application.required_approver_role.value} decision",
        )

    approved = body.decision == ApprovalDecisionType.approved
    application.status = ApplicationStatus.approved if approved else ApplicationStatus.declined
    application.decline_reason = None if approved else body.comment
    application.approvals.append(
        ApprovalDecision(
            approver_id=staff.id,
            approver_name=staff.name,
            role=staff.role,
            decision=body.decision,
            comment=body.comment,
        )
    )
    await audit.record(
        db, staff, body.decision.value, "application", application.id,
        body.comment or f"Application {body.decision.value} by {staff.name}",
    )
    await db.commit()
    return await _get(db, staff.lender_id, application_id)


@router.post(
    "/{application_id}/disburse",
    response_model=LoanResponse,
    status_code=status.HTTP_201_CREATED,
)
async def disburse_application(
    application_id: str,
    body: DisburseRequest,
    staff: DisbursementEditor,
    db: DbSession,
) -> Loan:
    application = await _get(db, staff.lender_id, application_id)
    if application.status != ApplicationStatus.approved:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only an approved application can be disbursed")

    existing = await db.scalar(select(Loan).where(Loan.application_id == application.id))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This application has already been disbursed")

    product = await db.scalar(
        select(LoanProduct)
        .where(LoanProduct.id == application.product_id, LoanProduct.lender_id == staff.lender_id)
        .options(selectinload(LoanProduct.fees))
    )
    approver = application.approvals[-1].approver_name if application.approvals else "Unknown"
    if approver == staff.name:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The approver and the person releasing funds must be different people",
        )

    loan = await loan_service.create_loan_from_application(
        db,
        application=application,
        product=product,
        channel=body.channel,
        reference=body.reference,
        approved_by=approver,
        disbursed_by=staff.name,
    )
    application.status = ApplicationStatus.disbursed
    await db.flush()
    await audit.record(
        db, staff, "disbursed", "loan", loan.id,
        f"{loan.net_disbursed:,.0f} disbursed via {body.channel.value} (ref {body.reference})",
    )
    await db.commit()

    fresh = await db.scalar(select(Loan).where(Loan.id == loan.id).options(selectinload(Loan.schedule)))
    return fresh
