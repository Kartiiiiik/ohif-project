from django.urls import path
from .views import (
    StudyListView, StudyDetailView,
    orthanc_studies, orthanc_study_detail, orthanc_series, sync_studies,
)

urlpatterns = [
    # Local DB
    path("", StudyListView.as_view(), name="study_list"),
    path("<str:orthanc_id>/", StudyDetailView.as_view(), name="study_detail"),
    # Orthanc proxies
    path("orthanc/all/", orthanc_studies, name="orthanc_studies"),
    path("orthanc/<str:orthanc_id>/", orthanc_study_detail, name="orthanc_study_detail"),
    path("orthanc/<str:study_id>/series/", orthanc_series, name="orthanc_series"),
    path("orthanc/sync/", sync_studies, name="sync_studies"),
]
