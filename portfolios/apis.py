from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import serializers, status
from portfolios.selectors import (
    portfolio_evolution_get, portfolio_list_get,
    portfolio_unit_root_test, portfolios_cointegration_test
)

class PortfolioListApi(APIView):
    """
    API endpoint para listar los portafolios disponibles y su rango de fechas.
    """
    class OutputSerializer(serializers.Serializer):
        id = serializers.IntegerField()
        name = serializers.CharField()
        min_date = serializers.DateField()
        max_date = serializers.DateField()

    def get(self, request):
        portfolios = portfolio_list_get()
        data = self.OutputSerializer(portfolios, many=True).data
        return Response(data, status=status.HTTP_200_OK)

class PortfolioEvolutionFilterSerializer(serializers.Serializer):
    fecha_inicio = serializers.DateField(required=True)
    fecha_fin = serializers.DateField(required=True)

class PortfolioEvolutionKpiSerializer(serializers.Serializer):
    roi = serializers.FloatField()
    mdd = serializers.FloatField()
    volatility = serializers.FloatField()
    sharpe = serializers.FloatField()
    star_asset = serializers.CharField(allow_null=True)
    star_asset_return = serializers.FloatField(allow_null=True)

class PortfolioEvolutionSeriesSerializer(serializers.Serializer):
    fecha = serializers.DateField()
    valor_total = serializers.DecimalField(max_digits=18, decimal_places=2)
    pesos = serializers.DictField(child=serializers.FloatField())

class PortfolioEvolutionOutputSerializer(serializers.Serializer):
    kpis = PortfolioEvolutionKpiSerializer()
    series = PortfolioEvolutionSeriesSerializer(many=True)

class PortfolioEvolutionApi(APIView):
    """
    API endpoint para obtener la evolución histórica de valores y pesos de un portafolio, junto con sus KPIs.
    """
    def get(self, request, portfolio_id):
        filter_serializer = PortfolioEvolutionFilterSerializer(data=request.query_params)
        filter_serializer.is_valid(raise_exception=True)
        
        fecha_inicio = filter_serializer.validated_data['fecha_inicio']
        fecha_fin = filter_serializer.validated_data['fecha_fin']
        
        evolution_data = portfolio_evolution_get(
            portfolio_id=portfolio_id,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin
        )
        
        output_serializer = PortfolioEvolutionOutputSerializer(evolution_data)
        return Response(output_serializer.data, status=status.HTTP_200_OK)


# ==========================================
# NUEVAS APIS: ANÁLISIS DE SERIES TEMPORALES
# ==========================================

class PortfolioEconometricsApi(APIView):
    """
    API endpoint para realizar pruebas econométricas (ADF) sobre un portafolio.
    """
    class FilterSerializer(serializers.Serializer):
        fecha_inicio = serializers.DateField(required=True)
        fecha_fin = serializers.DateField(required=True)

    class OutputSerializer(serializers.Serializer):
        adf_statistic = serializers.FloatField(required=False)
        p_value = serializers.FloatField(required=False)
        critical_values = serializers.DictField(child=serializers.FloatField(), required=False)
        has_unit_root = serializers.BooleanField(required=False)
        trend_type = serializers.CharField(required=False)
        conclusion = serializers.CharField(required=False)
        error = serializers.CharField(required=False)

    def get(self, request, portfolio_id):
        # 1. Validar filtros
        filter_serializer = self.FilterSerializer(data=request.query_params)
        filter_serializer.is_valid(raise_exception=True)
        
        # 2. Ejecutar test
        result = portfolio_unit_root_test(
            portfolio_id=portfolio_id,
            fecha_inicio=filter_serializer.validated_data['fecha_inicio'],
            fecha_fin=filter_serializer.validated_data['fecha_fin']
        )
        
        # 3. Serializar y responder
        output = self.OutputSerializer(result).data
        return Response(output, status=status.HTTP_200_OK)


class PortfoliosCointegrationApi(APIView):
    """
    API endpoint para realizar pruebas de cointegración entre portafolios.
    """
    class FilterSerializer(serializers.Serializer):
        fecha_inicio = serializers.DateField(required=True)
        fecha_fin = serializers.DateField(required=True)

    class OutputSerializer(serializers.Serializer):
        coint_statistic = serializers.FloatField(required=False)
        p_value = serializers.FloatField(required=False)
        is_cointegrated = serializers.BooleanField(required=False)
        conclusion = serializers.CharField(required=False)
        error = serializers.CharField(required=False)

    def get(self, request):
        # 1. Validar filtros
        filter_serializer = self.FilterSerializer(data=request.query_params)
        filter_serializer.is_valid(raise_exception=True)
        
        # 2. Ejecutar test
        result = portfolios_cointegration_test(
            fecha_inicio=filter_serializer.validated_data['fecha_inicio'],
            fecha_fin=filter_serializer.validated_data['fecha_fin']
        )
        
        # 3. Serializar y responder
        output = self.OutputSerializer(result).data
        return Response(output, status=status.HTTP_200_OK)
