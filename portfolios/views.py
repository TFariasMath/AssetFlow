from django.views.generic import TemplateView

class DashboardView(TemplateView):
    """
    Vista web tradicional para renderizar la página principal del dashboard interactivo.
    """
    template_name = 'portfolios/dashboard.html'
