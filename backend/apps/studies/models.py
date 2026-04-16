from django.db import models
from apps.users.models import User


class Study(models.Model):
    """Mirrors Orthanc study metadata locally for fast querying."""
    orthanc_id = models.CharField(max_length=64, unique=True)
    study_instance_uid = models.CharField(max_length=128, unique=True)
    patient_name = models.CharField(max_length=255, blank=True)
    patient_id = models.CharField(max_length=64, blank=True)
    patient_birth_date = models.CharField(max_length=16, blank=True)
    study_date = models.DateField(null=True, blank=True)
    study_description = models.CharField(max_length=255, blank=True)
    modalities = models.JSONField(default=list)
    series_count = models.IntegerField(default=0)
    instance_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "studies"
        ordering = ["-study_date", "-created_at"]

    def __str__(self):
        return f"{self.patient_name} - {self.study_description} ({self.study_date})"


class StudyAccess(models.Model):
    """Track which users have access to which studies."""
    study = models.ForeignKey(Study, on_delete=models.CASCADE, related_name="accesses")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="study_accesses")
    granted_at = models.DateTimeField(auto_now_add=True)
    granted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name="granted_accesses"
    )

    class Meta:
        unique_together = ["study", "user"]
