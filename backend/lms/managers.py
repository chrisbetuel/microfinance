from django.contrib.auth.base_user import BaseUserManager


class StaffManager(BaseUserManager):
    """`Staff` is the auth user model — it always belongs to a lender."""

    use_in_migrations = True

    def create_user(self, email, password, *, lender, **extra):
        if not email:
            raise ValueError("Staff must have an email address")
        member = self.model(email=self.normalize_email(email).lower(), lender=lender, **extra)
        member.set_password(password)
        member.save(using=self._db)
        return member

    def create_superuser(self, email, password, **extra):  # pragma: no cover - not used by the API
        raise NotImplementedError("Staff accounts are created through the lender workspace, not createsuperuser.")
