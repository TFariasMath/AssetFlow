from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import serializers, status
from portfolios.selectors import (
    portfolio_evolution_get, portfolio_list_get,
    portfolio_unit_root_test, portfolios_cointegration_test,
    portfolios_difference_get
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

class MinValuationSerializer(serializers.Serializer):
    value = serializers.FloatField()
    date = serializers.DateField()

class PortfolioEvolutionOutputSerializer(serializers.Serializer):
    kpis = PortfolioEvolutionKpiSerializer()
    series = PortfolioEvolutionSeriesSerializer(many=True)
    min_valuation = MinValuationSerializer()

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
        adf_statistic = serializers.FloatField()
        p_value = serializers.FloatField()
        critical_values = serializers.DictField(child=serializers.FloatField())
        has_unit_root = serializers.BooleanField()
        trend_type = serializers.CharField()
        conclusion = serializers.CharField()
        
        # Campos de KPSS
        kpss_statistic = serializers.FloatField()
        kpss_p_value = serializers.FloatField()
        kpss_critical_values = serializers.DictField(child=serializers.FloatField())
        kpss_is_stationary = serializers.BooleanField()
        kpss_lags = serializers.IntegerField()
        combined_diagnosis = serializers.CharField()

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
        coint_statistic = serializers.FloatField()
        p_value = serializers.FloatField()
        is_cointegrated = serializers.BooleanField()
        conclusion = serializers.CharField()

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


class PortfolioComparisonDifferenceApi(APIView):
    """
    API endpoint para obtener la diferencia de valoración diaria entre dos portafolios usando el ORM.
    """
    class FilterSerializer(serializers.Serializer):
        fecha_inicio = serializers.DateField(required=True)
        fecha_fin = serializers.DateField(required=True)
        p1 = serializers.IntegerField(default=1)
        p2 = serializers.IntegerField(default=2)

    class OutputSerializer(serializers.Serializer):
        fecha = serializers.DateField()
        valor_p1 = serializers.FloatField()
        valor_p2 = serializers.FloatField()
        diferencia = serializers.FloatField()
        diferencia_pct = serializers.FloatField()

    def get(self, request):
        filter_serializer = self.FilterSerializer(data=request.query_params)
        filter_serializer.is_valid(raise_exception=True)
        
        data = portfolios_difference_get(
            portfolio_id_1=filter_serializer.validated_data['p1'],
            portfolio_id_2=filter_serializer.validated_data['p2'],
            fecha_inicio=filter_serializer.validated_data['fecha_inicio'],
            fecha_fin=filter_serializer.validated_data['fecha_fin']
        )
        
        output = self.OutputSerializer(data, many=True).data
        return Response(output, status=status.HTTP_200_OK)


class PortfolioEtlApi(APIView):
    """
    API endpoint para ejecutar el comando load_data (migrar y recargar datos desde Excel) desde la interfaz.
    """
    def post(self, request):
        from django.core.management import call_command
        try:
            call_command('load_data')
            return Response({
                "status": "success",
                "message": "Base de datos migrada y datos del archivo Excel cargados exitosamente."
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({
                "status": "error",
                "message": f"Error al ejecutar el proceso ETL: {str(e)}"
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
