from django.core.management import call_command

from lms.models import Lender, Loan, Notification


def test_seed_demo_builds_an_explorable_workspace(capsys):
    call_command("seed_demo")
    lender = Lender.objects.get(name="Sele Microfinance")

    assert lender.staff.count() >= 8
    assert lender.products.count() == 3
    assert lender.borrowers.count() >= 10
    assert lender.applications.count() >= 5

    loans = Loan.objects.filter(lender=lender)
    assert loans.count() >= 5
    assert loans.filter(days_in_arrears__gt=0).exists(), "some loans should be in arrears"
    assert Notification.objects.filter(lender=lender, kind="arrears_reminder").exists()

    # re-running without --reset is a no-op
    call_command("seed_demo")
    assert Lender.objects.filter(name="Sele Microfinance").count() == 1

    call_command("seed_demo", "--reset")
    assert Lender.objects.filter(name="Sele Microfinance").count() == 1
