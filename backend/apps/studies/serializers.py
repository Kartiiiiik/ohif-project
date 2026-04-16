from rest_framework import serializers
from .models import Study, StudyAccess


class StudySerializer(serializers.ModelSerializer):
    class Meta:
        model = Study
        fields = [
            "id", "orthanc_id", "study_instance_uid",
            "patient_name", "patient_id", "patient_birth_date",
            "study_date", "study_description", "modalities",
            "series_count", "instance_count", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class StudyAccessSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudyAccess
        fields = ["id", "study", "user", "granted_at", "granted_by"]
        read_only_fields = ["id", "granted_at", "granted_by"]
