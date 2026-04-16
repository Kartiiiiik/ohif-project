import logging
from django.db import OperationalError, ProgrammingError
from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status

logger = logging.getLogger(__name__)


def custom_exception_handler(exc, context):
    """
    Always return a clean JSON response — never expose stack traces or
    Django's HTML debug page to the frontend.
    """

    # Let DRF handle known API exceptions first (validation errors, auth, etc.)
    response = exception_handler(exc, context)

    if response is not None:
        # DRF handled it — normalise to a consistent shape
        if isinstance(response.data, dict):
            # Flatten field errors into a single readable message
            errors = []
            for key, value in response.data.items():
                if key == "detail":
                    errors.append(str(value))
                elif isinstance(value, list):
                    errors.append(f"{key}: {', '.join(str(v) for v in value)}")
                else:
                    errors.append(f"{key}: {value}")
            response.data = {
                "error": " | ".join(errors) if errors else "An error occurred.",
                "detail": response.data,  # keep original for debugging
            }
        return response

    # DRF didn't handle it — this is an unhandled server error
    # Log the full exception server-side but return a safe message to client

    logger.exception(
        "Unhandled exception in %s",
        context.get("view", "unknown view"),
        exc_info=exc,
    )

    # Specific user-friendly messages for common DB errors
    if isinstance(exc, (OperationalError, ProgrammingError)):
        message = "A database error occurred. Please try again later."
    else:
        message = "An unexpected error occurred. Please try again later."

    return Response(
        {"error": message},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )