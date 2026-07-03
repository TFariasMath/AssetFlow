from django.urls import path
from django.views.decorators.csrf import csrf_exempt
from portfolios.views import DashboardView
from portfolios.apis import (
    PortfolioListApi, PortfolioEvolutionApi,
    PortfolioEconometricsApi, PortfoliosCointegrationApi,
    PortfolioEtlApi, PortfolioComparisonDifferenceApi
)

app_name = 'portfolios'

urlpatterns = [
    # Vista Web HTML
    path('', DashboardView.as_view(), name='dashboard'),
    
    # Endpoints de API REST
    path('api/portfolios/', PortfolioListApi.as_view(), name='portfolio-list-api'),
    path('api/portfolios/<int:portfolio_id>/evolution/', PortfolioEvolutionApi.as_view(), name='portfolio-evolution-api'),
    path('api/portfolios/<int:portfolio_id>/econometrics/', PortfolioEconometricsApi.as_view(), name='portfolio-econometrics-api'),
    path('api/portfolios/cointegration/', PortfoliosCointegrationApi.as_view(), name='portfolios-cointegration-api'),
    path('api/portfolios/comparison-difference/', PortfolioComparisonDifferenceApi.as_view(), name='portfolio-comparison-difference-api'),
    
    # Endpoint de mantenimiento (ETL / Migraciones)
    path('api/maintenance/load-data/', csrf_exempt(PortfolioEtlApi.as_view()), name='portfolio-etl-api'),
]
