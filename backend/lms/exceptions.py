from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler as drf_exception_handler


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Conflict"
    default_code = "conflict"


class UnprocessableEntity(APIException):
    status_code = 422
    default_detail = "Unprocessable entity"
    default_code = "unprocessable"


def _first_message(data):
    if isinstance(data, dict):
        for value in data.values():
            return _first_message(value)
    if isinstance(data, (list, tuple)) and data:
        return _first_message(data[0])
    return data


def exception_handler(exc, context):
    """Flatten every error body to `{"detail": "..."}` — the shape the frontend reads."""
    response = drf_exception_handler(exc, context)
    if response is None:
        return None
    data = response.data
    if not (isinstance(data, dict) and set(data.keys()) == {"detail"}):
        response.data = {"detail": str(_first_message(data))}
    return response
