from django.urls import path

from lms import views as v

urlpatterns = [
    path("auth/register", v.RegisterView.as_view()),
    path("auth/login", v.LoginView.as_view()),
    path("auth/me", v.MeView.as_view()),
    path("auth/change-password", v.ChangePasswordView.as_view()),

    path("lender", v.LenderView.as_view()),

    path("branches", v.BranchesView.as_view()),

    path("staff", v.StaffListView.as_view()),
    path("staff/<uuid:staff_id>", v.StaffDetailView.as_view()),

    path("holidays", v.HolidaysView.as_view()),
    path("holidays/<uuid:holiday_id>", v.HolidayDetailView.as_view()),

    path("borrowers", v.BorrowersView.as_view()),
    path("borrowers/<uuid:borrower_id>", v.BorrowerDetailView.as_view()),
    path("borrowers/<uuid:borrower_id>/blacklist", v.BorrowerBlacklistView.as_view()),
    path("borrowers/<uuid:borrower_id>/status", v.BorrowerStatusView.as_view()),
    path("borrowers/<uuid:borrower_id>/verify", v.BorrowerVerifyView.as_view()),
    path("borrowers/<uuid:borrower_id>/guarantors", v.BorrowerGuarantorsView.as_view()),
    path("borrowers/<uuid:borrower_id>/collateral", v.BorrowerCollateralView.as_view()),
    path("collateral", v.CollateralListView.as_view()),
    path("collateral/<uuid:collateral_id>", v.CollateralDetailView.as_view()),
    path("borrowers/<uuid:borrower_id>/documents", v.BorrowerDocumentUploadView.as_view()),
    path("borrowers/<uuid:borrower_id>/step-up", v.BorrowerStepUpView.as_view()),
    path("borrowers/<uuid:borrower_id>/savings", v.BorrowerSavingsView.as_view()),

    path("savings", v.SavingsListView.as_view()),

    path("groups", v.GroupsView.as_view()),
    path("groups/<uuid:group_id>", v.GroupDetailView.as_view()),
    path("groups/<uuid:group_id>/members", v.GroupMembersView.as_view()),
    path("groups/<uuid:group_id>/members/<uuid:membership_id>", v.GroupMemberDetailView.as_view()),
    path("groups/<uuid:group_id>/meetings", v.GroupMeetingsView.as_view()),
    path("groups/<uuid:group_id>/documents", v.GroupDocumentsView.as_view()),

    path("products", v.ProductsView.as_view()),
    path("products/<uuid:product_id>", v.ProductDetailView.as_view()),

    path("applications", v.ApplicationsView.as_view()),
    path("applications/<uuid:application_id>", v.ApplicationDetailView.as_view()),
    path("applications/<uuid:application_id>/submit", v.ApplicationSubmitView.as_view()),
    path("applications/<uuid:application_id>/start-assessment", v.ApplicationStartAssessmentView.as_view()),
    path("applications/<uuid:application_id>/assessment", v.ApplicationAssessmentView.as_view()),
    path("applications/<uuid:application_id>/documents", v.ApplicationDocumentsView.as_view()),
    path("applications/<uuid:application_id>/documents/<uuid:document_id>", v.ApplicationDocumentDetailView.as_view()),
    path("applications/<uuid:application_id>/decision", v.ApplicationDecisionView.as_view()),
    path("disbursements", v.DisbursementsView.as_view()),
    path("disbursements/preview", v.DisbursementPreviewView.as_view()),
    path("disbursements/<uuid:disbursement_id>", v.DisbursementDetailView.as_view()),
    path("disbursements/<uuid:disbursement_id>/<str:action>", v.DisbursementActionView.as_view()),
    path("ledger", v.LedgerView.as_view()),

    path("loans", v.LoansView.as_view()),
    path("loans/<uuid:loan_id>", v.LoanDetailView.as_view()),
    path("loans/<uuid:loan_id>/settle", v.LoanSettleView.as_view()),
    path("loans/<uuid:loan_id>/write-off", v.LoanWriteOffView.as_view()),
    path("loans/<uuid:loan_id>/restructure", v.LoanRestructureView.as_view()),
    path("loans/<uuid:loan_id>/collection-activities", v.LoanCollectionActivityView.as_view()),
    path("loans/<uuid:loan_id>/send-reminder", v.LoanReminderView.as_view()),

    path("collection-activities", v.CollectionActivitiesView.as_view()),
    path("collections/cases", v.CollectionCasesView.as_view()),
    path("collections/cases/assign", v.CollectionCasesAssignView.as_view()),
    path("collections/cases/<uuid:case_id>", v.CollectionCaseDetailView.as_view()),
    path("collections/dashboard", v.CollectionDashboardView.as_view()),
    path("loans/<uuid:loan_id>/collection-timeline", v.LoanCollectionTimelineView.as_view()),

    path("repayments", v.RepaymentsView.as_view()),
    path("groups/<uuid:group_id>/payments", v.GroupPaymentsView.as_view()),
    path("reconciliation", v.ReconciliationView.as_view()),
    path("reconciliation/import", v.StatementImportView.as_view()),
    path("reconciliation/rematch", v.StatementRematchView.as_view()),
    path("reconciliation/lines/<uuid:line_id>/<str:action>", v.StatementLineActionView.as_view()),
    path("repayments/<uuid:repayment_id>/reverse", v.RepaymentReverseView.as_view()),

    path("till/today", v.TillTodayView.as_view()),
    path("till", v.TillView.as_view()),

    path("audit", v.AuditView.as_view()),
    path("notifications", v.NotificationsView.as_view()),

    path("integrations", v.IntegrationsView.as_view()),
    path("sms/send", v.SmsSendView.as_view()),
    path("sms/bulk", v.SmsBulkView.as_view()),
    path("payments", v.PaymentsView.as_view()),
    path("payments/collect", v.PaymentCollectView.as_view()),
    path("payments/callback", v.PaymentCallbackView.as_view()),
    path("payments/<uuid:payment_id>/simulate", v.PaymentSimulateView.as_view()),

    path("export/borrowers", v.BorrowersExportView.as_view()),
    path("export/loans", v.LoansExportView.as_view()),
    path("export/repayments", v.RepaymentsExportView.as_view()),
]
