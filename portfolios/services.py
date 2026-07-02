import pandas as pd
from datetime import datetime, date
from django.db import transaction
from decimal import Decimal
from collections import defaultdict
from typing import Dict, List
from portfolios.models import (
    RawWeightIngestion, RawPriceIngestion,
    Asset, Portfolio, Price, PortfolioAssetQuantity,
    PortfolioDailySnapshot, PortfolioAssetDailySnapshot
)

@transaction.atomic
def etl_import_portfolio_data(*, excel_file_path: str) -> None:
    """
    Coordinador del pipeline ETL Medallion.
    """
    # 1. Fase Bronze: Ingesta directa de datos crudos
    _etl_ingest_bronze(excel_file_path=excel_file_path)

    # 2. Fase Silver: Estandarización y relaciones limpias
    _etl_transform_silver()

    # 3. Fase Gold: Agregación de snapshots financieros precalculados
    _etl_aggregate_gold()


def _etl_ingest_bronze(*, excel_file_path: str) -> None:
    """
    Lee el archivo Excel e inserta la información sin alterar en la capa Bronze.
    """
    # Limpiar tablas Bronze para una importación limpia
    RawWeightIngestion.objects.all().delete()
    RawPriceIngestion.objects.all().delete()

    xl = pd.ExcelFile(excel_file_path)
    df_w = xl.parse('weights')
    df_p = xl.parse('Precios')

    # Ingestar Weights (Bronze)
    weight_instances = []
    for _, row in df_w.iterrows():
        weight_instances.append(RawWeightIngestion(
            raw_date=str(row['Fecha']),
            raw_asset_name=str(row['activos']),
            raw_portfolio_1_weight=str(row['portafolio 1']),
            raw_portfolio_2_weight=str(row['portafolio 2'])
        ))
    RawWeightIngestion.objects.bulk_create(weight_instances)

    # Ingestar Precios (Bronze) - Despivotar tabla ancha a formato largo
    df_p_long = df_p.melt(id_vars=['Dates'], var_name='activo', value_name='precio')
    
    price_ingestion_instances = []
    for _, row in df_p_long.iterrows():
        price_ingestion_instances.append(RawPriceIngestion(
            raw_date=str(row['Dates']),
            raw_asset_name=str(row['activo']),
            raw_price_value=str(row['precio'])
        ))
    RawPriceIngestion.objects.bulk_create(price_ingestion_instances)


def _etl_transform_silver() -> None:
    """
    Limpia los datos de Bronze, crea portafolios/activos,
    carga precios con ForeignKey a Asset, y calcula las cantidades iniciales (c_i,0).
    """
    # Limpiar tablas Silver para evitar duplicados
    Price.objects.all().delete()
    PortfolioAssetQuantity.objects.all().delete()

    # 1. Crear portafolios estándar
    portfolio_1, _ = Portfolio.objects.get_or_create(name="Portafolio 1")
    portfolio_2, _ = Portfolio.objects.get_or_create(name="Portafolio 2")

    # 2. Crear activos normalizados
    raw_weights = RawWeightIngestion.objects.all()
    asset_map = {}
    for rw in raw_weights:
        # Corregir codificaciones en nombres
        clean_name = rw.raw_asset_name.strip()
        asset_obj, _ = Asset.objects.get_or_create(name=clean_name)
        asset_map[clean_name] = asset_obj

    # 3. Transformar y cargar Precios
    raw_prices = RawPriceIngestion.objects.all()
    price_instances = []
    
    # Cachear activos por nombre para evitar queries repetitivas
    all_assets = Asset.objects.all()
    conformed_asset_map = {a.name: a for a in all_assets}

    for rp in raw_prices:
        asset_name = rp.raw_asset_name.strip()
        
        # Obtener activo con conformado
        if asset_name in conformed_asset_map:
            asset_obj = conformed_asset_map[asset_name]
        else:
            asset_obj, _ = Asset.objects.get_or_create(name=asset_name)
            conformed_asset_map[asset_name] = asset_obj

        # Normalizar fecha
        # El formato guardado en Bronze es '2022-02-15 00:00:00'
        raw_date_str = rp.raw_date.split()[0]
        date_obj = datetime.strptime(raw_date_str, '%Y-%m-%d').date()

        price_instances.append(Price(
            asset=asset_obj,
            date=date_obj,
            price=Decimal(rp.raw_price_value)
        ))

    Price.objects.bulk_create(price_instances, ignore_conflicts=True)

    # 4. Calcular cantidades físicas iniciales (c_i,0)
    t0_date = date(2022, 2, 15)
    initial_prices = {}
    for price_obj in Price.objects.filter(date=t0_date):
        initial_prices[price_obj.asset.name] = price_obj.price

    V0 = Decimal('1000000000.00') # 1,000 millones USD
    quantity_instances = []

    for rw in raw_weights:
        asset_name = rw.raw_asset_name.strip()
        asset_obj = conformed_asset_map[asset_name]
        
        w_1 = Decimal(rw.raw_portfolio_1_weight)
        w_2 = Decimal(rw.raw_portfolio_2_weight)

        p_0 = initial_prices.get(asset_name)
        if p_0 is None or p_0 == 0:
            raise ValueError(f"No se encontró un precio inicial válido para {asset_name} en la fecha {t0_date}")

        # Fórmula: c_i,0 = (w_i,0 * V_0) / p_i,0
        c_1_0 = (w_1 * V0) / p_0
        c_2_0 = (w_2 * V0) / p_0

        quantity_instances.append(PortfolioAssetQuantity(
            portfolio=portfolio_1,
            asset=asset_obj,
            quantity=c_1_0
        ))
        quantity_instances.append(PortfolioAssetQuantity(
            portfolio=portfolio_2,
            asset=asset_obj,
            quantity=c_2_0
        ))

    PortfolioAssetQuantity.objects.bulk_create(quantity_instances)


def _etl_aggregate_gold() -> None:
    """
    Precalcula los snapshots históricos diarios de pesos (w_i,t) y valor total (V_t)
    para la capa Gold de alta velocidad de consulta.
    """
    # Limpiar tablas Gold
    PortfolioDailySnapshot.objects.all().delete()
    PortfolioAssetDailySnapshot.objects.all().delete()

    portfolios = Portfolio.objects.all()

    # Pre-cargar todas las cantidades
    quantities = PortfolioAssetQuantity.objects.all()
    # Estructura: quantity_map[portfolio_id][asset_id] = quantity
    quantity_map = defaultdict(dict)
    for q in quantities:
        quantity_map[q.portfolio_id][q.asset_id] = q.quantity

    # Obtener todas las cotizaciones de precios ordenadas por fecha
    prices = Price.objects.all().select_related('asset').order_by('date')
    prices_by_date = defaultdict(list)
    for p in prices:
        prices_by_date[p.date].append(p)

    gold_snapshots = []
    gold_asset_snapshots = []

    # Recorrer cada día
    for curr_date in sorted(prices_by_date.keys()):
        date_prices = prices_by_date[curr_date]

        # Recorrer cada portafolio
        for port in portfolios:
            port_qty_map = quantity_map[port.id]
            if not port_qty_map:
                continue

            V_t = Decimal('0.0')
            asset_values = {}

            # Calcular monto invertido por activo (x_i,t) y sumatoria del portafolio (V_t)
            for p in date_prices:
                if p.asset_id not in port_qty_map:
                    continue
                
                qty = port_qty_map[p.asset_id]
                x_i_t = p.price * qty
                asset_values[p.asset] = x_i_t
                V_t += x_i_t

            # Guardar el snapshot global del portafolio (Gold)
            # Solo guardamos si V_t > 0
            if V_t > 0:
                gold_snapshots.append(PortfolioDailySnapshot(
                    portfolio=port,
                    date=curr_date,
                    total_value=V_t
                ))

                # Guardar snapshots detallados por activo (Gold)
                for asset_obj, x_i_t in asset_values.items():
                    w_i_t = x_i_t / V_t
                    gold_asset_snapshots.append(PortfolioAssetDailySnapshot(
                        portfolio=port,
                        asset=asset_obj,
                        date=curr_date,
                        amount=x_i_t,
                        weight=w_i_t
                    ))

    # Inserción en masa ultrarrápida
    PortfolioDailySnapshot.objects.bulk_create(gold_snapshots)
    PortfolioAssetDailySnapshot.objects.bulk_create(gold_asset_snapshots)
