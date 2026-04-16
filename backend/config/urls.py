from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.users.urls")),
    path("api/studies/", include("apps.studies.urls")),
    path("api/annotations/", include("apps.annotations.urls")),
]
