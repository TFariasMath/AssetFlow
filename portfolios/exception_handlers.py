from django.core.exceptions import ValidationError as DjangoValidationError, PermissionDenied
from django.http import Http404

from rest_framework.views import exception_handler
from rest_framework import exceptions
from rest_framework.serializers import as_serializer_error
from rest_framework.response import Response

from portfolios.exceptions import ApplicationError

def custom_exception_handler(exc, ctx):
    """
    Manejador global de excepciones para Django REST Framework siguiendo el Django Styleguide.
    """
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(as_serializer_error(exc))

    if isinstance(exc, Http404):
        exc = exceptions.NotFound()

    if isinstance(exc, PermissionDenied):
        exc = exceptions.PermissionDenied()

    response = exception_handler(exc, ctx)

    # Si la excepción no es manejada por DRF (es un error inesperado de Python o de negocio)
    if response is None:
        if isinstance(exc, ApplicationError):
            data = {
                "message": exc.message,
                "extra": exc.extra
            }
            return Response(data, status=400)
        return response

    # Si es una excepción de validación estándar de DRF, estructuramos la salida
    if isinstance(exc, exceptions.ValidationError):
        response.data = {
            "message": "Validation error",
            "extra": response.data
        }

    return response
