class ApplicationError(Exception):
    """
    Excepción de negocio personalizada para lanzar errores controlados desde services y selectors.
    """
    def __init__(self, message: str, extra: dict = None):
        super().__init__(message)
        self.message = message
        self.extra = extra or {}
