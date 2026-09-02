from django.contrib import admin

from lms import models


@admin.register(models.Staff)
class StaffAdmin(admin.ModelAdmin):
    ordering = ("name",)
    list_display = ("name", "email", "role", "lender", "is_active")
    list_filter = ("role", "is_active", "lender")
    search_fields = ("name", "email")
    readonly_fields = ("last_login", "date_joined", "password")
    exclude = ("groups", "user_permissions")


for _model in (
    models.Lender, models.Branch, models.Holiday, models.Borrower, models.LoanProduct,
    models.Application, models.Loan, models.Repayment, models.AuditLogEntry,
):
    admin.site.register(_model)
