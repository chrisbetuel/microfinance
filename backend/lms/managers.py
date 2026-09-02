from django.contrib.auth.base_user import BaseUserManager


class StaffManager(BaseUserManager):
    """`Staff` is the auth user model — every account belongs to a lender."""

    use_in_migrations = True

    def create_user(self, email, password=None, *, lender, **extra):
        if not email:
            raise ValueError("Staff must have an email address")
        member = self.model(email=self.normalize_email(email).lower(), lender=lender, **extra)
        member.set_password(password)
        member.save(using=self._db)
        return member

    def create_superuser(self, email, password=None, **extra):
        """Used by `manage.py createsuperuser`. Superusers get a dedicated
        platform-admin lender so the multi-tenant model stays intact."""
        from lms.models import Lender

        lender, _ = Lender.objects.get_or_create(name="Platform", defaults={"currency": "USD"})
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("role", "platform_admin")
        extra.setdefault("name", email)
        return self.create_user(email, password, lender=lender, **extra)
