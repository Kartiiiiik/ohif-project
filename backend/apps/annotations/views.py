from rest_framework import generics, permissions
from .models import Annotation
from .serializers import AnnotationSerializer


class AnnotationListCreateView(generics.ListCreateAPIView):
    serializer_class = AnnotationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Annotation.objects.select_related("created_by", "study")
        study_id = self.request.query_params.get("study")
        sop_uid = self.request.query_params.get("sop_instance_uid")
        if study_id:
            qs = qs.filter(study_id=study_id)
        if sop_uid:
            qs = qs.filter(sop_instance_uid=sop_uid)
        return qs


class AnnotationDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = AnnotationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Annotation.objects.filter(created_by=self.request.user)
