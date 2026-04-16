from django.db import models
from apps.users.models import User
from apps.studies.models import Study


class Annotation(models.Model):
    class AnnotationType(models.TextChoices):
        LENGTH = "length", "Length"
        ANGLE = "angle", "Angle"
        ROI = "roi", "ROI"
        ARROW = "arrow", "Arrow"
        TEXT = "text", "Text"
        ELLIPSE = "ellipse", "Ellipse"
        RECTANGLE = "rectangle", "Rectangle"

    study = models.ForeignKey(Study, on_delete=models.CASCADE, related_name="annotations")
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name="annotations")

    series_instance_uid = models.CharField(max_length=128)
    sop_instance_uid = models.CharField(max_length=128)
    frame_number = models.IntegerField(default=0)

    annotation_type = models.CharField(max_length=20, choices=AnnotationType.choices)
    data = models.JSONField()  # Cornerstone tool state JSON
    label = models.CharField(max_length=255, blank=True)
    note = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.annotation_type} on {self.sop_instance_uid} by {self.created_by}"
