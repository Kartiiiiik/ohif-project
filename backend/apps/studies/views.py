import httpx
from django.conf import settings
from rest_framework import generics, permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from .models import Study
from .serializers import StudySerializer


def get_orthanc_client():
    return httpx.Client(
        base_url=settings.ORTHANC_URL,
        auth=(settings.ORTHANC_USERNAME, settings.ORTHANC_PASSWORD),
        timeout=30.0,
    )


class StudyListView(generics.ListAPIView):
    serializer_class = StudySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Study.objects.all()
        patient = self.request.query_params.get("patient")
        modality = self.request.query_params.get("modality")
        if patient:
            qs = qs.filter(patient_name__icontains=patient)
        if modality:
            qs = qs.filter(modalities__contains=[modality])
        return qs


class StudyDetailView(generics.RetrieveAPIView):
    queryset = Study.objects.all()
    serializer_class = StudySerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = "orthanc_id"


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def orthanc_studies(request):
    """Proxy: list all studies from Orthanc."""
    try:
        with get_orthanc_client() as client:
            resp = client.get("/studies?expand")
            resp.raise_for_status()
            return Response(resp.json())
    except httpx.RequestError as e:
        return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def orthanc_study_detail(request, orthanc_id):
    """Proxy: get a single study from Orthanc."""
    try:
        with get_orthanc_client() as client:
            resp = client.get(f"/studies/{orthanc_id}")
            resp.raise_for_status()
            return Response(resp.json())
    except httpx.RequestError as e:
        return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def orthanc_series(request, study_id):
    """Proxy: get series list for a study."""
    try:
        with get_orthanc_client() as client:
            resp = client.get(f"/studies/{study_id}/series")
            resp.raise_for_status()
            return Response(resp.json())
    except httpx.RequestError as e:
        return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["POST"])
@permission_classes([permissions.IsAdminUser])
def sync_studies(request):
    """Pull studies from Orthanc and sync to local DB."""
    try:
        with get_orthanc_client() as client:
            resp = client.get("/studies?expand")
            resp.raise_for_status()
            studies_data = resp.json()

        synced = 0
        for s in studies_data:
            main_tags = s.get("MainDicomTags", {})
            patient_tags = s.get("PatientMainDicomTags", {})
            Study.objects.update_or_create(
                orthanc_id=s["ID"],
                defaults={
                    "study_instance_uid": main_tags.get("StudyInstanceUID", ""),
                    "patient_name": patient_tags.get("PatientName", ""),
                    "patient_id": patient_tags.get("PatientID", ""),
                    "study_description": main_tags.get("StudyDescription", ""),
                    "modalities": s.get("RequestedTags", {}).get("ModalitiesInStudy", []),
                    "series_count": len(s.get("Series", [])),
                },
            )
            synced += 1

        return Response({"synced": synced})
    except httpx.RequestError as e:
        return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
