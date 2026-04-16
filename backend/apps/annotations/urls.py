from django.urls import path
from .views import AnnotationListCreateView, AnnotationDetailView

urlpatterns = [
    path("", AnnotationListCreateView.as_view(), name="annotation_list"),
    path("<int:pk>/", AnnotationDetailView.as_view(), name="annotation_detail"),
]
