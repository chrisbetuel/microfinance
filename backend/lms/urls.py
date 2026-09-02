from django.urls import path

from lms import views as v

urlpatterns = [
    path("auth/register", v.RegisterView.as_view()),
    path("auth/login", v.LoginView.as_view()),
    path("auth/me", v.MeView.as_view()),

    path("lender", v.LenderView.as_view()),

    path("branches", v.BranchesView.as_view()),

    path("staff", v.StaffListView.as_view()),
    path("staff/<uuid:staff_id>", v.StaffDetailView.as_view()),

    path("holidays", v.HolidaysView.as_view()),
    path("holidays/<uuid:holiday_id>", v.HolidayDetailView.as_view()),

    path("borrowers", v.BorrowersView.as_view()),
    path("borrowers/<uuid:borrower_id>", v.BorrowerDetailView.as_view()),
    path("borrowers/<uuid:borrower_id>/blacklist", v.BorrowerBlacklistView.as_view()),

    path("products", v.ProductsView.as_view()),
    path("products/<uuid:product_id>", v.ProductDetailView.as_view()),

    path("applications", v.ApplicationsView.as_view()),
    path("applications/<uuid:application_id>", v.ApplicationDetailView.as_view()),
    path("applications/<uuid:application_id>/decision", v.ApplicationDecisionView.as_view()),
    path("applications/<uuid:application_id>/disburse", v.ApplicationDisburseView.as_view()),

    path("loans", v.LoansView.as_view()),
    path("loans/<uuid:loan_id>", v.LoanDetailView.as_view()),

    path("repayments", v.RepaymentsView.as_view()),
    path("repayments/<uuid:repayment_id>/reverse", v.RepaymentReverseView.as_view()),

    path("audit", v.AuditView.as_view()),
]
