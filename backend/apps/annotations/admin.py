from django.contrib import admin
from .models import Annotation


@admin.register(Annotation)
class AnnotationAdmin(admin.ModelAdmin):
    list_display = ["annotation_type", "study", "created_by", "label", "created_at"]
    list_filter = ["annotation_type", "created_at"]
    search_fields = ["label", "sop_instance_uid", "series_instance_uid"]
