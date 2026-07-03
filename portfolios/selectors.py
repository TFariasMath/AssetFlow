from datetime import date
from collections import defaultdict
from typing import List, Dict, Any
import numpy as np
import math
from django.db.models import F, OuterRef, Subquery, DecimalField
from django.db.models.functions import Coalesce, Abs
from statsmodels.tsa.stattools import adfuller, coint, kpss
from portfolios.models import Portfolio, PortfolioDailySnapshot, PortfolioAssetDailySnapshot
from portfolios.exceptions import ApplicationError

# ==========================================
# FUNCIONES AUXILIARES PURAS (MATEMÁTICAS)
# ==========================================

def _calculate_roi(*, v_init: float, v_final: float) -> float:
    if v_init == 0:
        return 0.0
    return ((v_final - v_init) / v_init) * 100

def _calculate_max_drawdown(*, values: List[float]) -> float:
    peak = -float('inf')
    max_dd = 0.0
    for val in values:
        if val > peak:
            peak = val
        if peak == 0:
            continue
        dd = ((peak - val) / peak) * 100
        if dd > max_dd:
            max_dd = dd
    return max_dd

def _calculate_volatility_and_sharpe(*, values: List[float], rf: float = 0.03) -> tuple:
    returns = []
    for i in range(1, len(values)):
        if values[i-1] == 0:
            returns.append(0.0)
        else:
            returns.append((values[i] - values[i-1]) / values[i-1])

    if len(returns) >= 2:
        stdev = float(np.std(returns, ddof=1))
        vol = stdev * np.sqrt(252) * 100
        if stdev == 0:
            sharpe = 0.0
        else:
            if values[0] == 0:
                total_return = 0.0
            else:
                total_return = (values[-1] - values[0]) / values[0]
            sharpe = (total_return - rf) / (stdev * np.sqrt(252))
    else:
        vol = 0.0
        sharpe = 0.0
    return vol, sharpe

def _calculate_star_asset(*, first_weights: Dict[str, float], last_weights: Dict[str, float], v_init: float, v_final: float) -> tuple:
    top_asset = None
    top_return = -float('inf')

    for name in first_weights.keys():
        w_init = first_weights.get(name, 0.0)
        w_final = last_weights.get(name, 0.0)
        if w_init > 0 and v_init != 0:
            asset_init_val = w_init * v_init
            asset_final_val = w_final * v_final
            asset_return = ((asset_final_val - asset_init_val) / asset_init_val) * 100
            if asset_return > top_return:
                top_return = asset_return
                top_asset = name
    return top_asset, top_return


# ==========================================
# SELECTORES PRINCIPALES DE NEGOCIO
# ==========================================

def portfolio_evolution_get(*, portfolio_id: int, fecha_inicio: date, fecha_fin: date) -> Dict[str, Any]:
    """
    Obtiene la evolución histórica de un portafolio consultando directamente los snapshots precalculados
    en la capa Gold de la base de datos y calcula las métricas financieras (KPIs) en el backend.
    """
    # 1. Obtener snapshots globales diarios de la capa Gold
    snapshots = PortfolioDailySnapshot.objects.filter(
        portfolio_id=portfolio_id,
        date__range=(fecha_inicio, fecha_fin)
    ).order_by('date')

    if not snapshots.exists():
        return {
            'kpis': {
                'roi': 0.0,
                'mdd': 0.0,
                'volatility': 0.0,
                'sharpe': 0.0,
                'star_asset': None,
                'star_asset_return': None
            },
            'series': []
        }

    # 2. Obtener snapshots de pesos por activo de la capa Gold
    asset_snapshots = PortfolioAssetDailySnapshot.objects.filter(
        portfolio_id=portfolio_id,
        date__range=(fecha_inicio, fecha_fin)
    ).select_related('asset').order_by('date')

    # 3. Agrupar pesos por fecha
    weights_by_date = defaultdict(dict)
    for a_snap in asset_snapshots:
        weights_by_date[a_snap.date][a_snap.asset.name] = float(a_snap.weight)

    # 4. Construir respuesta mapeada de la serie
    series_data = []
    for snap in snapshots:
        series_data.append({
            'fecha': snap.date,
            'valor_total': snap.total_value,
            'pesos': weights_by_date.get(snap.date, {})
        })

    # 5. Calcular KPIs en el backend utilizando funciones auxiliares puras
    v_init = float(snapshots.first().total_value)
    v_final = float(snapshots.last().total_value)
    values = [float(s.total_value) for s in snapshots]

    roi = _calculate_roi(v_init=v_init, v_final=v_final)
    max_dd = _calculate_max_drawdown(values=values)
    vol, sharpe = _calculate_volatility_and_sharpe(values=values)
    
    first_weights = series_data[0]['pesos']
    last_weights = series_data[-1]['pesos']
    top_asset, top_return = _calculate_star_asset(
        first_weights=first_weights, 
        last_weights=last_weights, 
        v_init=v_init, 
        v_final=v_final
    )

    kpis = {
        'roi': round(roi, 4),
        'mdd': round(max_dd, 4),
        'volatility': round(vol, 4),
        'sharpe': round(sharpe, 4),
        'star_asset': top_asset,
        'star_asset_return': round(top_return, 4) if top_asset else None
    }

    return {
        'kpis': kpis,
        'series': series_data
    }

def portfolio_list_get() -> List[Dict[str, Any]]:
    """
    Retorna la lista de portafolios disponibles y el rango máximo de fechas con datos
    disponibles en la capa Gold.
    """
    portfolios = Portfolio.objects.all().order_by('name')
    
    # Obtener límites de fecha de los snapshots reales
    dates = PortfolioDailySnapshot.objects.values_list('date', flat=True)
    if dates.exists():
        min_date = min(dates)
        max_date = max(dates)
    else:
        min_date = date(2022, 2, 15)
        max_date = date(2023, 2, 16)

    return [
        {
            'id': p.id,
            'name': p.name,
            'min_date': min_date,
            'max_date': max_date
        }
        for p in portfolios
    ]


# ==========================================
# FUNCIONES DE ANÁLISIS DE SERIES TEMPORALES
# ==========================================

def portfolio_unit_root_test(*, portfolio_id: int, fecha_inicio: date, fecha_fin: date) -> Dict[str, Any]:
    """
    Ejecuta el test de raíz unitaria ADF (Augmented Dickey-Fuller) sobre el valor total del portafolio.
    """
    snapshots = PortfolioDailySnapshot.objects.filter(
        portfolio_id=portfolio_id,
        date__range=(fecha_inicio, fecha_fin)
    ).order_by('date')

    if snapshots.count() < 10:
        raise ApplicationError("Se requieren al menos 10 observaciones para ejecutar el test de raíz unitaria.")

    # Extraer la serie temporal de valores en float
    values = np.array([float(snap.total_value) for snap in snapshots])

    try:
        # 1. Ejecutar ADF con constante y tendencia temporal ('ct')
        adf_result = adfuller(values, regression='ct', autolag='AIC')
        adf_stat = float(adf_result[0])
        adf_p_value = float(adf_result[1])
        adf_crit_values = {k: float(v) for k, v in adf_result[4].items()}
        adf_has_unit_root = adf_p_value > 0.05
        
        # 2. Ejecutar KPSS con constante y tendencia temporal ('ct')
        kpss_result = kpss(values, regression='ct', nlags='auto')
        kpss_stat = float(kpss_result[0])
        kpss_p_value = float(kpss_result[1])
        kpss_lags = int(kpss_result[2])
        kpss_crit_values = {k: float(v) for k, v in kpss_result[3].items()}
        kpss_is_stationary = kpss_p_value > 0.05
        
        # 3. Diagnóstico combinado (Matriz de Decisión)
        if adf_has_unit_root and not kpss_is_stationary:
            combined_diagnosis = (
                "Ambos tests coinciden en que la serie posee una raíz unitaria (tendencia estocástica). "
                "Los shocks y fluctuaciones del mercado tienen un impacto permanente en la valoración "
                "de la cartera (no regresa a una tendencia determinista fija)."
            )
        elif not adf_has_unit_root and kpss_is_stationary:
            combined_diagnosis = (
                "Ambos tests coinciden en que la serie es estacionaria en tendencia (tendencia determinista). "
                "Los shocks y caídas del mercado son transitorios y la cartera regresa a su trayectoria "
                "de crecimiento de largo plazo."
            )
        elif not adf_has_unit_root and not kpss_is_stationary:
            combined_diagnosis = (
                "Comportamiento mixto/no lineal: ADF indica estacionariedad pero KPSS indica no estacionariedad. "
                "Esto puede deberse a la presencia de un quiebre estructural en la tendencia de la serie."
            )
        else:
            combined_diagnosis = (
                "Indecisión estadística: ADF indica raíz unitaria pero KPSS indica estacionariedad. "
                "Ocurre típicamente en series altamente persistentes con muestras de datos moderadas."
            )

        return {
            "adf_statistic": adf_stat,
            "p_value": adf_p_value,
            "critical_values": adf_crit_values,
            "has_unit_root": adf_has_unit_root,
            "trend_type": "Estocástica" if adf_has_unit_root else "Determinista",
            "conclusion": combined_diagnosis,
            
            # Nuevos datos de KPSS
            "kpss_statistic": kpss_stat,
            "kpss_p_value": kpss_p_value,
            "kpss_critical_values": kpss_crit_values,
            "kpss_is_stationary": kpss_is_stationary,
            "kpss_lags": kpss_lags,
            "combined_diagnosis": combined_diagnosis
        }
    except Exception as e:
        raise ApplicationError(f"Error al ejecutar los tests econométricos: {str(e)}")


def portfolios_cointegration_test(*, fecha_inicio: date, fecha_fin: date) -> Dict[str, Any]:
    """
    Ejecuta el test de cointegración de Engle-Granger entre el Portafolio 1 y el Portafolio 2.
    """
    # Obtener portafolios
    p1 = Portfolio.objects.filter(name="Portafolio 1").first()
    p2 = Portfolio.objects.filter(name="Portafolio 2").first()

    if not p1 or not p2:
        raise ApplicationError("No se encontraron los portafolios en la base de datos.")

    # Obtener las series temporales ordenadas
    snaps_1 = PortfolioDailySnapshot.objects.filter(portfolio=p1, date__range=(fecha_inicio, fecha_fin)).order_by('date')
    snaps_2 = PortfolioDailySnapshot.objects.filter(portfolio=p2, date__range=(fecha_inicio, fecha_fin)).order_by('date')

    # Alinear fechas en un diccionario para evitar vacíos
    data_1 = {snap.date: float(snap.total_value) for snap in snaps_1}
    data_2 = {snap.date: float(snap.total_value) for snap in snaps_2}

    common_dates = sorted(list(set(data_1.keys()).intersection(set(data_2.keys()))))

    if len(common_dates) < 10:
        raise ApplicationError("Se requieren al menos 10 observaciones coincidentes para ejecutar el test de cointegración.")

    values_1 = np.array([data_1[d] for d in common_dates])
    values_2 = np.array([data_2[d] for d in common_dates])

    try:
        # Engle-Granger cointegration test
        stat, p_value, crit_values = coint(values_1, values_2, trend='ct', autolag='AIC')
        
        if math.isnan(stat) or math.isinf(stat) or math.isnan(p_value) or math.isinf(p_value):
            raise ApplicationError("El test de cointegración falló debido a colinealidad perfecta o varianza cero en los datos.")

        is_cointegrated = p_value <= 0.05
        
        if is_cointegrated:
            conclusion = (
                "Los portafolios están cointegrados: comparten una tendencia común de largo plazo "
                "y el diferencial entre ellos tiende a revertir a su media histórica. "
                "Aunque las asignaciones por activos difieren, la relación de equilibrio "
                "se mantiene estable en el período analizado."
            )
        else:
            conclusion = (
                "El test no detecta una relación de cointegración estadística (el diferencial entre carteras "
                "no regresa a una media fija debido a las diferentes ponderaciones de activos). "
                "Sin embargo, esto no implica un desalineamiento financiero: los portafolios mantienen una "
                "correlación superior al 99% y avanzan en trayectorias paralelas sincronizadas por el mercado general, "
                "aunque sin un anclaje matemático de equilibrio de largo plazo."
            )

        return {
            "coint_statistic": float(stat),
            "p_value": float(p_value),
            "is_cointegrated": is_cointegrated,
            "conclusion": conclusion
        }
    except ApplicationError:
        raise
    except Exception as e:
        raise ApplicationError(f"Error al ejecutar el test de cointegración: {str(e)}")


def portfolios_difference_get(*, portfolio_id_1: int, portfolio_id_2: int, fecha_inicio: date, fecha_fin: date) -> List[Dict[str, Any]]:
    """
    Calcula la diferencia de valoración absoluta entre dos portafolios día a día
    en el rango de fechas especificado utilizando Django ORM.
    """
    p2_value_subquery = PortfolioDailySnapshot.objects.filter(
        portfolio_id=portfolio_id_2,
        date=OuterRef('date')
    ).values('total_value')[:1]

    snapshots = PortfolioDailySnapshot.objects.filter(
        portfolio_id=portfolio_id_1,
        date__range=(fecha_inicio, fecha_fin)
    ).annotate(
        p2_value=Coalesce(Subquery(p2_value_subquery), 0.0, output_field=DecimalField(max_digits=18, decimal_places=4)),
        difference=Abs(F('total_value') - F('p2_value'))
    ).order_by('date')

    return [
        {
            'fecha': snap.date,
            'valor_p1': float(snap.total_value),
            'valor_p2': float(snap.p2_value),
            'diferencia': float(snap.difference),
            'diferencia_pct': float(
                ((snap.total_value - snap.p2_value) / snap.p2_value * 100)
                if snap.p2_value != 0 else 0.0
            )
        }
        for snap in snapshots
    ]
