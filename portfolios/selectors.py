from datetime import date
from collections import defaultdict
from typing import List, Dict, Any
import numpy as np
from statsmodels.tsa.stattools import adfuller, coint
from portfolios.models import Portfolio, PortfolioDailySnapshot, PortfolioAssetDailySnapshot

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

    # 5. Calcular KPIs en el backend
    v_init = float(snapshots.first().total_value)
    v_final = float(snapshots.last().total_value)

    # A. ROI
    roi = ((v_final - v_init) / v_init) * 100

    # B. Máximo Drawdown (MDD)
    peak = -float('inf')
    max_dd = 0.0
    for snap in snapshots:
        val = float(snap.total_value)
        if val > peak:
            peak = val
        dd = ((peak - val) / peak) * 100
        if dd > max_dd:
            max_dd = dd

    # C. Volatilidad y Sharpe
    values = [float(s.total_value) for s in snapshots]
    returns = []
    for i in range(1, len(values)):
        returns.append((values[i] - values[i-1]) / values[i-1])

    if len(returns) >= 2:
        stdev = float(np.std(returns, ddof=1))
        vol = stdev * np.sqrt(252) * 100
        rf = 0.03
        total_return = (v_final - v_init) / v_init
        sharpe = (total_return - rf) / (stdev * np.sqrt(252))
    else:
        vol = 0.0
        sharpe = 0.0

    # D. Activo Estrella
    first_weights = series_data[0]['pesos']
    last_weights = series_data[-1]['pesos']
    top_asset = None
    top_return = -float('inf')

    for name in first_weights.keys():
        w_init = first_weights.get(name, 0.0)
        w_final = last_weights.get(name, 0.0)
        if w_init > 0:
            asset_init_val = w_init * v_init
            asset_final_val = w_final * v_final
            asset_return = ((asset_final_val - asset_init_val) / asset_init_val) * 100
            if asset_return > top_return:
                top_return = asset_return
                top_asset = name

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
# NUEVAS FUNCIONES: ANÁLISIS DE SERIES TEMPORALES
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
        return {
            "error": "Se requieren al menos 10 observaciones para ejecutar el test de raíz unitaria."
        }

    # Extraer la serie temporal de valores en float
    values = np.array([float(snap.total_value) for snap in snapshots])

    try:
        # Ejecutar ADF con constante y tendencia temporal ('ct')
        # autolag='AIC' selecciona automáticamente el lag óptimo
        result = adfuller(values, regression='ct', autolag='AIC')
        
        adf_stat = float(result[0])
        p_value = float(result[1])
        crit_values = {k: float(v) for k, v in result[4].items()}
        
        # Conclusión: si p_value <= 0.05, rechazamos H0 (existe estacionariedad en tendencia)
        is_stationary = p_value <= 0.05
        trend_type = "Determinista" if is_stationary else "Estocástica"
        
        if is_stationary:
            conclusion = (
                "La serie temporal es estacionaria en tendencia (tendencia determinista). "
                "Los shocks y fluctuaciones en la valoración son transitorios; el portafolio "
                "regresa a su trayectoria de crecimiento predecible a largo plazo."
            )
        else:
            conclusion = (
                "La serie temporal posee una raíz unitaria (tendencia estocástica). "
                "Los shocks y caídas del mercado tienen un impacto permanente en la valoración "
                "del portafolio (el nivel del portafolio no tiene memoria de retorno a una tendencia fija)."
            )

        return {
            "adf_statistic": adf_stat,
            "p_value": p_value,
            "critical_values": crit_values,
            "has_unit_root": not is_stationary,
            "trend_type": trend_type,
            "conclusion": conclusion
        }
    except Exception as e:
        return {
            "error": f"Error al ejecutar el test ADF: {str(e)}"
        }


def portfolios_cointegration_test(*, fecha_inicio: date, fecha_fin: date) -> Dict[str, Any]:
    """
    Ejecuta el test de cointegración de Engle-Granger entre el Portafolio 1 y el Portafolio 2.
    """
    # Obtener portafolios
    p1 = Portfolio.objects.filter(name="Portafolio 1").first()
    p2 = Portfolio.objects.filter(name="Portafolio 2").first()

    if not p1 or not p2:
        return {
            "error": "No se encontraron los portafolios en la base de datos."
        }

    # Obtener las series temporales ordenadas
    snaps_1 = PortfolioDailySnapshot.objects.filter(portfolio=p1, date__range=(fecha_inicio, fecha_fin)).order_by('date')
    snaps_2 = PortfolioDailySnapshot.objects.filter(portfolio=p2, date__range=(fecha_inicio, fecha_fin)).order_by('date')

    # Alinear fechas en un diccionario para evitar vacíos
    data_1 = {snap.date: float(snap.total_value) for snap in snaps_1}
    data_2 = {snap.date: float(snap.total_value) for snap in snaps_2}

    common_dates = sorted(list(set(data_1.keys()).intersection(set(data_2.keys()))))

    if len(common_dates) < 10:
        return {
            "error": "Se requieren al menos 10 observaciones coincidentes para ejecutar el test de cointegración."
        }

    values_1 = np.array([data_1[d] for d in common_dates])
    values_2 = np.array([data_2[d] for d in common_dates])

    try:
        # Engle-Granger cointegration test
        # y0 es el portafolio 1, y1 es el portafolio 2
        # trend='ct' incluye constante y tendencia lineal
        stat, p_value, crit_values = coint(values_1, values_2, trend='ct', autolag='AIC')
        
        is_cointegrated = p_value <= 0.05
        
        if is_cointegrated:
            conclusion = (
                "Los portafolios están cointegrados (comparten una tendencia común de largo plazo). "
                "A pesar de las diferencias de asignación en los activos, existe una relación de equilibrio "
                "temporal estable y no se desvían de forma permanente."
            )
        else:
            conclusion = (
                "No existe relación de cointegración entre los portafolios en este período. "
                "Las trayectorias de valorización son independientes y pueden divergir de forma permanente."
            )

        return {
            "coint_statistic": float(stat),
            "p_value": float(p_value),
            "is_cointegrated": is_cointegrated,
            "conclusion": conclusion
        }
    except Exception as e:
        return {
            "error": f"Error al ejecutar el test de cointegración: {str(e)}"
        }
