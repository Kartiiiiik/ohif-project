from django.contrib import admin
from .models import Study, StudyAccess


@admin.register(Study)
class StudyAdmin(admin.ModelAdmin):
    list_display = ["patient_name", "patient_id", "study_date", "study_description", "series_count"]
    list_filter = ["study_date", "modalities"]
    search_fields = ["patient_name", "patient_id", "study_instance_uid"]
    ordering = ["-study_date"]


@admin.register(StudyAccess)
class StudyAccessAdmin(admin.ModelAdmin):
    list_display = ["study", "user", "granted_at", "granted_by"]
    list_filter = ["granted_at"]
