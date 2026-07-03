from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase
from unittest.mock import patch
from datetime import date
from decimal import Decimal
from portfolios.models import (
    RawWeightIngestion, RawPriceIngestion,
    Asset, Portfolio, Price, PortfolioAssetQuantity,
    PortfolioDailySnapshot, PortfolioAssetDailySnapshot
)
from portfolios.services import _etl_transform_silver, _etl_aggregate_gold
from portfolios.selectors import (
    portfolio_evolution_get, portfolio_list_get,
    portfolio_unit_root_test, portfolios_cointegration_test,
    _calculate_roi, _calculate_max_drawdown,
    _calculate_volatility_and_sharpe, _calculate_star_asset,
    portfolios_difference_get
)
from portfolios.exceptions import ApplicationError

class MedallionPipelineTests(TestCase):
    def setUp(self):
        # 1. Preparar datos ficticios en la capa Bronze
        self.date_0_str = "2022-02-15 00:00:00"
        self.date_1_str = "2022-02-16 00:00:00"

        # Ingresos de pesos en Bronze para Portafolio 1 y 2
        # Portafolio 1: Activo A 60%, Activo B 40%
        # Portafolio 2: Activo A 30%, Activo B 70%
        RawWeightIngestion.objects.create(
            raw_date=self.date_0_str,
            raw_asset_name="Activo A",
            raw_portfolio_1_weight="0.60",
            raw_portfolio_2_weight="0.30"
        )
        RawWeightIngestion.objects.create(
            raw_date=self.date_0_str,
            raw_asset_name="Activo B",
            raw_portfolio_1_weight="0.40",
            raw_portfolio_2_weight="0.70"
        )

        # Ingresos de precios en Bronze (Activo A y Activo B para dos fechas)
        # Activo A: 100 USD en t0, 110 USD en t1
        # Activo B: 200 USD en t0, 190 USD en t1
        prices_raw = [
            ("2022-02-15 00:00:00", "Activo A", "100.00"),
            ("2022-02-15 00:00:00", "Activo B", "200.00"),
            ("2022-02-16 00:00:00", "Activo A", "110.00"),
            ("2022-02-16 00:00:00", "Activo B", "190.00")
        ]
        for dt, asset, pr in prices_raw:
            RawPriceIngestion.objects.create(
                raw_date=dt,
                raw_asset_name=asset,
                raw_price_value=pr
            )

    def test_pipeline_bronze_to_silver(self):
        # Ejecutar la transformación a la capa Silver
        _etl_transform_silver()

        # Verificar creación de activos y portafolios con conformación
        self.assertEqual(Asset.objects.count(), 2)
        self.assertEqual(Portfolio.objects.count(), 2)

        # Verificar precios con conformación (4 registros)
        self.assertEqual(Price.objects.count(), 4)
        
        # Verificar cantidades iniciales (2 activos * 2 portafolios = 4 registros)
        self.assertEqual(PortfolioAssetQuantity.objects.count(), 4)

        # Verificar cálculos matemáticos de las cantidades físicas en Silver:
        # V0 = 1,000,000,000 USD
        # Portafolio 1:
        # c_A_0 = (0.60 * 1,000,000,000) / 100 = 6,000,000
        # c_B_0 = (0.40 * 1,000,000,000) / 200 = 2,000,000
        port_1 = Portfolio.objects.get(name="Portafolio 1")
        asset_a = Asset.objects.get(name="Activo A")
        asset_b = Asset.objects.get(name="Activo B")

        qty_a = PortfolioAssetQuantity.objects.get(portfolio=port_1, asset=asset_a).quantity
        qty_b = PortfolioAssetQuantity.objects.get(portfolio=port_1, asset=asset_b).quantity

        self.assertAlmostEqual(float(qty_a), 6000000.0)
        self.assertAlmostEqual(float(qty_b), 2000000.0)

    def test_pipeline_silver_to_gold(self):
        # 1. Transformar a Silver primero
        _etl_transform_silver()
        # 2. Agregar a Gold
        _etl_aggregate_gold()

        # Verificar que se crearon los snapshots correspondientes (2 fechas * 2 portafolios = 4 snapshots globales)
        self.assertEqual(PortfolioDailySnapshot.objects.count(), 4)
        # 2 fechas * 2 portafolios * 2 activos = 8 snapshots de pesos
        self.assertEqual(PortfolioAssetDailySnapshot.objects.count(), 8)

        # Validar consistencia matemática en Gold para Portafolio 1 al día 1 (16/02/2022)
        # V_1 = (110.00 * 6,000,000) + (190.00 * 2,000,000) = 660,000,000 + 380,000,000 = 1,040,000,000 USD
        port_1 = Portfolio.objects.get(name="Portafolio 1")
        date_1 = date(2022, 2, 16)
        
        snapshot = PortfolioDailySnapshot.objects.get(portfolio=port_1, date=date_1)
        self.assertAlmostEqual(float(snapshot.total_value), 1040000000.0)

        # Pesos en Gold para ese día:
        # w_A = 660M / 1040M ≈ 0.634615
        # w_B = 380M / 1040M ≈ 0.365384
        asset_a = Asset.objects.get(name="Activo A")
        asset_b = Asset.objects.get(name="Activo B")
        
        snap_a = PortfolioAssetDailySnapshot.objects.get(portfolio=port_1, asset=asset_a, date=date_1)
        snap_b = PortfolioAssetDailySnapshot.objects.get(portfolio=port_1, asset=asset_b, date=date_1)

        self.assertAlmostEqual(float(snap_a.weight), 660000000.0 / 1040000000.0, places=5)
        self.assertAlmostEqual(float(snap_b.weight), 380000000.0 / 1040000000.0, places=5)

    def test_selector_queries_gold_snapshots_correctly(self):
        # 1. Cargar todo
        _etl_transform_silver()
        _etl_aggregate_gold()

        # 2. Consultar selector
        port_1 = Portfolio.objects.get(name="Portafolio 1")
        date_0 = date(2022, 2, 15)
        date_1 = date(2022, 2, 16)

        evolution_data = portfolio_evolution_get(
            portfolio_id=port_1.id,
            fecha_inicio=date_0,
            fecha_fin=date_1
        )
        evolution = evolution_data['series']
        kpis = evolution_data['kpis']

        # Debe tener 2 días de evolución
        self.assertEqual(len(evolution), 2)
        
        # Verificar KPIs en el backend
        self.assertAlmostEqual(kpis['roi'], 4.0)
        self.assertAlmostEqual(kpis['mdd'], 0.0)
        self.assertEqual(kpis['star_asset'], 'Activo A')
        
        # Verificar el día inicial (t0)
        self.assertEqual(evolution[0]['fecha'], date_0)
        self.assertAlmostEqual(float(evolution[0]['valor_total']), 1000000000.0)
        self.assertAlmostEqual(evolution[0]['pesos']['Activo A'], 0.60)
        self.assertAlmostEqual(evolution[0]['pesos']['Activo B'], 0.40)

        # Verificar el día siguiente (t1)
        self.assertEqual(evolution[1]['fecha'], date_1)
        self.assertAlmostEqual(float(evolution[1]['valor_total']), 1040000000.0)
        self.assertAlmostEqual(evolution[1]['pesos']['Activo A'], 660000000.0 / 1040000000.0, places=5)
        self.assertAlmostEqual(evolution[1]['pesos']['Activo B'], 380000000.0 / 1040000000.0, places=5)

    def test_list_portfolios_reads_correct_range_limits(self):
        _etl_transform_silver()
        _etl_aggregate_gold()

        portfolios_list = portfolio_list_get()
        self.assertEqual(len(portfolios_list), 2)
        
        # Deben compartir el mismo límite por los snapshots guardados
        self.assertEqual(portfolios_list[0]['min_date'], date(2022, 2, 15))
        self.assertEqual(portfolios_list[0]['max_date'], date(2022, 2, 16))

    def test_econometric_selectors_runs_tests_successfully(self):
        # 1. Limpiar e Ingestar 15 días de cotizaciones en Bronze para habilitar los tests de series
        RawWeightIngestion.objects.all().delete()
        RawPriceIngestion.objects.all().delete()

        RawWeightIngestion.objects.create(
            raw_date="2022-02-15 00:00:00",
            raw_asset_name="Activo A",
            raw_portfolio_1_weight="0.60",
            raw_portfolio_2_weight="0.30"
        )
        RawWeightIngestion.objects.create(
            raw_date="2022-02-15 00:00:00",
            raw_asset_name="Activo B",
            raw_portfolio_1_weight="0.40",
            raw_portfolio_2_weight="0.70"
        )

        # Ingestar del 15 de febrero al 01 de marzo (15 días)
        from datetime import timedelta
        base_date = date(2022, 2, 15)
        for i in range(15):
            curr_d = base_date + timedelta(days=i)
            date_str = f"{curr_d.strftime('%Y-%m-%d')} 00:00:00"
            price_a = float(100 + i + (i % 3) * 2)
            price_b = float(200 - i * 0.5 + (i % 2) * 5)
            
            RawPriceIngestion.objects.create(raw_date=date_str, raw_asset_name="Activo A", raw_price_value=str(price_a))
            RawPriceIngestion.objects.create(raw_date=date_str, raw_asset_name="Activo B", raw_price_value=str(price_b))

        # 2. Correr pipeline completo
        _etl_transform_silver()
        _etl_aggregate_gold()

        # 15 días * 2 portafolios = 30 snapshots globales
        self.assertEqual(PortfolioDailySnapshot.objects.count(), 30)

        port_1 = Portfolio.objects.get(name="Portafolio 1")
        start_date = date(2022, 2, 15)
        end_date = base_date + timedelta(days=14)

        # 3. Validar Test ADF + KPSS (Análisis de Tendencia)
        adf_result = portfolio_unit_root_test(
            portfolio_id=port_1.id,
            fecha_inicio=start_date,
            fecha_fin=end_date
        )
        self.assertNotIn("error", adf_result)
        self.assertIn("adf_statistic", adf_result)
        self.assertIn("p_value", adf_result)
        self.assertIn("trend_type", adf_result)
        self.assertIn("conclusion", adf_result)
        
        # Nuevas validaciones de KPSS
        self.assertIn("kpss_statistic", adf_result)
        self.assertIn("kpss_p_value", adf_result)
        self.assertIn("kpss_critical_values", adf_result)
        self.assertIn("kpss_is_stationary", adf_result)
        self.assertIn("kpss_lags", adf_result)
        self.assertIn("combined_diagnosis", adf_result)

        # 4. Validar Test de Cointegración (Engle-Granger)
        coint_result = portfolios_cointegration_test(
            fecha_inicio=start_date,
            fecha_fin=end_date
        )
        self.assertNotIn("error", coint_result)
        self.assertIn("coint_statistic", coint_result)
        self.assertIn("p_value", coint_result)
        self.assertIn("is_cointegrated", coint_result)
        self.assertIn("conclusion", coint_result)

    def test_econometric_selectors_raise_application_error_on_insufficient_data(self):
        _etl_transform_silver()
        _etl_aggregate_gold()
        port_1 = Portfolio.objects.get(name="Portafolio 1")
        # Rango de solo 2 días (insuficiente para el mínimo de 10)
        start_date = date(2022, 2, 15)
        end_date = date(2022, 2, 16)
        
        with self.assertRaises(ApplicationError):
            portfolio_unit_root_test(portfolio_id=port_1.id, fecha_inicio=start_date, fecha_fin=end_date)
            
        with self.assertRaises(ApplicationError):
            portfolios_cointegration_test(fecha_inicio=start_date, fecha_fin=end_date)

    def test_pure_helper_functions(self):
        # Test ROI helper
        self.assertAlmostEqual(_calculate_roi(v_init=100.0, v_final=110.0), 10.0)
        self.assertAlmostEqual(_calculate_roi(v_init=0.0, v_final=10.0), 0.0)
        
        # Test Max Drawdown helper
        self.assertAlmostEqual(_calculate_max_drawdown(values=[100.0, 110.0, 90.0, 95.0]), 18.181818, places=4)
        
        # Test Volatility and Sharpe helper
        vol, sharpe = _calculate_volatility_and_sharpe(values=[100.0, 101.0, 100.5, 102.0], rf=0.03)
        self.assertGreater(vol, 0.0)
        self.assertIsNotNone(sharpe)


class PortfolioApiTests(APITestCase):
    def setUp(self):
        # 1. Limpiar e Ingestar
        RawWeightIngestion.objects.all().delete()
        RawPriceIngestion.objects.all().delete()

        RawWeightIngestion.objects.create(
            raw_date="2022-02-15 00:00:00",
            raw_asset_name="Activo A",
            raw_portfolio_1_weight="0.60",
            raw_portfolio_2_weight="0.30"
        )
        RawWeightIngestion.objects.create(
            raw_date="2022-02-15 00:00:00",
            raw_asset_name="Activo B",
            raw_portfolio_1_weight="0.40",
            raw_portfolio_2_weight="0.70"
        )

        from datetime import timedelta
        base_date = date(2022, 2, 15)
        for i in range(15):
            curr_d = base_date + timedelta(days=i)
            date_str = f"{curr_d.strftime('%Y-%m-%d')} 00:00:00"
            price_a = float(100 + i + (i % 3) * 2)
            price_b = float(200 - i * 0.5 + (i % 2) * 5)
            RawPriceIngestion.objects.create(raw_date=date_str, raw_asset_name="Activo A", raw_price_value=str(price_a))
            RawPriceIngestion.objects.create(raw_date=date_str, raw_asset_name="Activo B", raw_price_value=str(price_b))

        _etl_transform_silver()
        _etl_aggregate_gold()

    def test_portfolio_list_api(self):
        url = reverse('portfolios:portfolio-list-api')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response.data[0]['name'], 'Portafolio 1')

    def test_portfolio_evolution_api(self):
        port_1 = Portfolio.objects.get(name="Portafolio 1")
        url = reverse('portfolios:portfolio-evolution-api', kwargs={'portfolio_id': port_1.id})
        response = self.client.get(url, {'fecha_inicio': '2022-02-15', 'fecha_fin': '2022-03-01'})
        self.assertEqual(response.status_code, 200)
        self.assertIn('kpis', response.data)
        self.assertIn('series', response.data)
        self.assertEqual(len(response.data['series']), 15)

    def test_portfolio_econometrics_api(self):
        port_1 = Portfolio.objects.get(name="Portafolio 1")
        url = reverse('portfolios:portfolio-econometrics-api', kwargs={'portfolio_id': port_1.id})
        response = self.client.get(url, {'fecha_inicio': '2022-02-15', 'fecha_fin': '2022-03-01'})
        self.assertEqual(response.status_code, 200)
        self.assertIn('adf_statistic', response.data)
        self.assertIn('p_value', response.data)
        self.assertIn('kpss_statistic', response.data)
        self.assertIn('kpss_p_value', response.data)
        self.assertIn('kpss_critical_values', response.data)
        self.assertIn('kpss_is_stationary', response.data)
        self.assertIn('kpss_lags', response.data)
        self.assertIn('combined_diagnosis', response.data)

    def test_portfolios_cointegration_api(self):
        url = reverse('portfolios:portfolios-cointegration-api')
        response = self.client.get(url, {'fecha_inicio': '2022-02-15', 'fecha_fin': '2022-03-01'})
        self.assertEqual(response.status_code, 200)
        self.assertIn('coint_statistic', response.data)

    def test_portfolios_cointegration_api_insufficient_data_returns_400(self):
        url = reverse('portfolios:portfolios-cointegration-api')
        response = self.client.get(url, {'fecha_inicio': '2022-02-15', 'fecha_fin': '2022-02-16'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('message', response.data)
        self.assertEqual(response.data['message'], "Se requieren al menos 10 observaciones coincidentes para ejecutar el test de cointegración.")

    @patch('django.core.management.call_command')
    def test_portfolio_etl_api(self, mock_call_command):
        url = reverse('portfolios:portfolio-etl-api')
        response = self.client.post(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'success')
        mock_call_command.assert_called_once_with('load_data')

    def test_portfolios_difference_selector(self):
        _etl_transform_silver()
        _etl_aggregate_gold()
        
        p1 = Portfolio.objects.get(name="Portafolio 1")
        p2 = Portfolio.objects.get(name="Portafolio 2")
        date_0 = date(2022, 2, 15)
        date_1 = date(2022, 2, 16)

        data = portfolios_difference_get(
            portfolio_id_1=p1.id,
            portfolio_id_2=p2.id,
            fecha_inicio=date_0,
            fecha_fin=date_1
        )
        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]['fecha'], date_0)
        self.assertAlmostEqual(data[0]['diferencia'], 0.0)
        self.assertEqual(data[1]['fecha'], date_1)
        self.assertAlmostEqual(data[1]['diferencia'], 2250000.0)

    def test_portfolio_comparison_difference_api(self):
        p1 = Portfolio.objects.get(name="Portafolio 1")
        p2 = Portfolio.objects.get(name="Portafolio 2")
        url = reverse('portfolios:portfolio-comparison-difference-api')
        response = self.client.get(url, {
            'fecha_inicio': '2022-02-15',
            'fecha_fin': '2022-03-01',
            'p1': p1.id,
            'p2': p2.id
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 15)
        self.assertIn('fecha', response.data[0])
        self.assertIn('diferencia', response.data[0])
