# AssetFlow

Analisis Avanzado de Portafolios de Inversion — Dashboard interactivo con metricas financieras, tests econometricos (ADF, cointegracion) y visualizacion de evolucion de activos.

---

## Quick Start

### Requisitos

- Python 3.11+
- pip

### Instalacion

```bash
# 1. Clonar el repositorio
git clone <repo-url>
cd assetflow

# 2. Crear y activar entorno virtual
python -m venv venv
source venv/bin/activate   # Linux / Mac
venv\Scripts\activate      # Windows

# 3. Instalar dependencias
pip install -r requirements.txt

# 4. Ejecutar migraciones y cargar datos
python manage.py load_data

# 5. Iniciar servidor de desarrollo
python manage.py runserver
```

Luego abrir `http://localhost:8000/` en el navegador.

> [!TIP]
> **Administración desde la Interfaz**: Ya no necesitas usar la terminal para aplicar migraciones o recargar los datos cuando modifiques el archivo `datos.xlsx`. Ahora puedes hacer clic en el botón **"Procesar ETL"** en la barra superior del programa para migrar y cargar los datos automáticamente desde la propia web.

### Comandos Útiles (Terminal)

```bash
# Recargar datos desde datos.xlsx manualmente por terminal (limpia y re-importa todo)
python manage.py load_data

# Ejecutar la suite de tests unitarios
python manage.py test portfolios

# Shell interactivo de Django para explorar el modelo ORM
python manage.py shell
```

---

## Arquitectura

Este proyecto sigue una **Arquitectura en Capas** con un **Pipeline ETL tipo Medallion** (Bronce -> Plata -> Oro), combinando varios metapatrones arquitectónicos para construir un sistema modular, testeable y de alto rendimiento analítico.

### Mapa de Metapatrones Implementados

| Metapatron | Aplicacion en el proyecto |
|---|---|
| **Monolith** | Django monoproceso con una sola app (`portfolios`). Despliegue monolitico que prioriza la velocidad de desarrollo y depuracion. |
| **Layers** | Separacion en capas: Interface (API/Views), Application (Services), Domain (Models), Infrastructure (ORM/SQLite). |
| **Pipeline** | Pipeline ETL secuencial de 3 etapas (Bronze -> Silver -> Gold). Procesamiento batch de datos financieros desde Excel. |
| **Shared Repository** | Base de datos SQLite unica y compartida que todas las capas consultan. |
| **CQRS** | Separacion implicita de comandos (`services.py` — escritura ETL) y consultas (`selectors.py` — lectura de snapshots Gold). |
| **Backends for Frontends (BFF)** | API REST independiente (`apis.py`) que alimenta exclusivamente al frontend JavaScript con datos precalculados. |

### Topologia del Sistema

```
+---------------------------------------------------------------+
|                   INTERFACE (BFF)                              |
|  +----------+  +-------------------------------------------+  |
|  | views.py |  |               apis.py                     |  |
|  | (Django  |  |  REST Endpoints:                          |  |
|  |  Template)|  |  PortfolioListApi                         |  |
|  |           |  |  PortfolioEvolutionApi                    |  |
|  |           |  |  PortfolioEconometricsApi                 |  |
|  |           |  |  PortfoliosCointegrationApi               |  |
|  +----------+  +-------------------------------------------+  |
+---------------------------------------------------------------+
                          |
+---------------------------------------------------------------+
|                  APPLICATION (Orquestador)                     |
|  +-----------------------------------------------------------+ |
|  | services.py                                               | |
|  |  etl_import_portfolio_data()  <- Coordinador del Pipeline | |
|  |    _etl_ingest_bronze()       -> Capa Bronce              | |
|  |    _etl_transform_silver()    -> Capa Plata               | |
|  |    _etl_aggregate_gold()      -> Capa Oro                 | |
|  +-----------------------------------------------------------+ |
+---------------------------------------------------------------+
                          |
+---------------------------------------------------------------+
|               DOMAIN (Modelos de Negocio)                      |
|  +-----------------------------------------------------------+ |
|  | models.py                                                  | |
|  |  +------------------------------------------------------+ | |
|  |  | BRONZE (Datos Crudos)                                 | | |
|  |  |  RawWeightIngestion                                   | | |
|  |  |  RawPriceIngestion                                    | | |
|  |  +------------------------------------------------------+ | |
|  |  | SILVER (Datos Conformados / Normalizados)             | | |
|  |  |  Asset, Portfolio, Price                              | | |
|  |  |  PortfolioAssetQuantity                               | | |
|  |  +------------------------------------------------------+ | |
|  |  | GOLD (Snapshots Precalculados)                        | | |
|  |  |  PortfolioDailySnapshot                                | | |
|  |  |  PortfolioAssetDailySnapshot                          | | |
|  |  +------------------------------------------------------+ | |
|  +-----------------------------------------------------------+ |
+---------------------------------------------------------------+
                          |
+---------------------------------------------------------------+
|           INFRASTRUCTURE (Shared Repository)                   |
|  +-----------------------------------------------------------+ |
|  | SQLite (db.sqlite3)                                       | |
|  | Apache Zeppelin - Notebooks de analisis exploratorio      | |
|  +-----------------------------------------------------------+ |
+---------------------------------------------------------------+
```

---

## Pipeline Medallion (Bronce -> Plata -> Oro)

El nucleo del sistema es un **Pipeline ETL** batch de tres etapas, siguiendo el patron de arquitectura Medallion adaptado a Django + SQLite.

### 1. Capa Bronce (Raw Data Ingestion)

- **Funcion**: `_etl_ingest_bronze()`
- Lee el archivo `datos.xlsx` (hojas `weights` y `Precios`) e inserta los datos en crudo sin transformar
- Modelos: `RawWeightIngestion`, `RawPriceIngestion`
- Almacena fechas, nombres de activos y valores como `CharField` (datos no normalizados)

### 2. Capa Plata (Conformed Relational Layer)

- **Funcion**: `_etl_transform_silver()`
- Limpia y normaliza los datos:
  - Crea entidades `Asset` y `Portfolio` con nombres estandarizados
  - Transforma precios con ForeignKey a `Asset` y formato `Decimal`
  - Calcula cantidades fisicas iniciales usando la formula:

> **c_i,0 = (w_i,0 x V0) / p_i,0**

- Valor inicial: **V0 = $1,000,000,000 USD**
- Modelos: `Asset`, `Portfolio`, `Price`, `PortfolioAssetQuantity`

### 3. Capa Oro (Aggregated Business Snapshots)

- **Funcion**: `_etl_aggregate_gold()`
- Precalcula snapshots diarios para consultas ultra-rapidas:
  - **Vt = Suma(p_i,t x c_i,0)** — Valor total del portafolio
  - **w_i,t = (p_i,t x c_i,0) / Vt** — Peso de cada activo
- Modelos: `PortfolioDailySnapshot`, `PortfolioAssetDailySnapshot`

### Flujo del Pipeline

```
+------------------+     +------------------+     +------------------+
|     BRONZE       |     |     SILVER       |     |      GOLD        |
|                  |     |                  |     |                  |
|  Raw Data        | --> |  Clean           | --> |  Pre-computed    |
|  Ingestion       |     |  Relational      |     |  Snapshots       |
|  (Excel)         |     |  Layer           |     |                  |
+------------------+     +------------------+     +------------------+
       |                       |                         |
       v                       v                         v
 RawWeightIngestion     Asset, Portfolio         PortfolioDailySnapshot
 RawPriceIngestion      Price, Quantity          PortfolioAssetSnapshot
```

---

## API REST (BFF - Backend for Frontends)

Los endpoints estan disenados como un **Backend for Frontends (BFF)**, sirviendo exclusivamente al dashboard JavaScript.

| Endpoint | Metodo | Descripcion |
|---|---|---|
| `GET /api/portfolios/` | List | Lista portafolios disponibles con rango de fechas |
| `GET /api/portfolios/{id}/evolution/` | Detail | Evolucion historica de Vt y w_i,t con KPIs |
| `GET /api/portfolios/{id}/econometrics/` | Detail | Test ADF (Raiz Unitaria) sobre un portafolio |
| `GET /api/portfolios/cointegration/` | List | Test de Cointegracion (Engle-Granger) entre portafolios |

### KPIs Calculados

- **ROI**: ((V_final - V_inicial) / V_inicial) x 100
- **MDD**: Maxima caida acumulada pico-a-valle
- **Volatilidad Anualizada**: sigma(retornos) x sqrt(252) x 100
- **Ratio Sharpe**: (Total Return - 3%) / (sigma x sqrt(252))
- **Activo Estrella**: Activo con mayor rendimiento individual en el periodo

---

## Tests

Suite completa de tests unitarios en `tests.py` que validan cada etapa del pipeline:

- `test_pipeline_bronze_to_silver` — Verifica transformacion y calculos matematicos de cantidades fisicas
- `test_pipeline_silver_to_gold` — Verifica agregacion correcta de snapshots y consistencia de pesos
- `test_selector_queries_gold_snapshots_correctly` — Verifica que los selectores consultan la capa Gold y los KPIs se calculan bien
- `test_list_portfolios_reads_correct_range_limits` — Verifica limites de fechas
- `test_econometric_selectors_runs_tests_successfully` — Verifica que ADF y cointegracion se ejecutan sin errores

```bash
python manage.py test portfolios
```

---

## Stack Tecnologico

| Componente | Tecnologia |
|---|---|
| Backend | Django 5.2, Django REST Framework |
| Base de Datos | SQLite |
| Frontend | JavaScript vanilla, ApexCharts |
| Analisis | NumPy, statsmodels (ADF, cointegracion) |
| ETL | pandas, openpyxl |
| Gestion | Django Management Command (`load_data`) |

---

## Metapatrones: La Arquitectura Explicada

Este proyecto se describe usando una taxonomía de metapatrones arquitectónicos, un lenguaje de patrones que organiza las arquitecturas de software según su estructura y función. A continuación se explica cada metapatrón presente en el sistema.

---

### 1. Monolith

**Estructura:** Un solo bloque de codigo sin modularidad interna fuerte.

```
+-----------------------------------------------------+
|                                                     |
|            +---------------------------+            |
|            |                           |            |
|            |     AssetFlow              |            |
|            |                           |            |
|            |     portfolios/           |            |
|            |       models.py           |            |
|            |       services.py         |            |
|            |       selectors.py        |            |
|            |       apis.py             |            |
|            |       tests.py            |            |
|            |                           |            |
|            +---------------------------+            |
|                                                     |
|     portfolio_project/                               |
|       settings.py                                    |
|       urls.py                                        |
|                                                     |
+-----------------------------------------------------+
              Un solo proceso Django
```

**Beneficios:** Desarrollo rapido, depuracion sencilla (un solo debugger), baja latencia interna, estado auto-consistente (transacciones atomicas).

**Aplicacion:** Django monoproceso con una sola app (`portfolios`). Ideal para prototipado y MVP. Toda la logica de negocio, API y frontend conviven en el mismo proceso.

---

### 2. Layers (Capas)

**Estructura:** Un componente por nivel de abstraccion. Las capas superiores (abstractas, cambiantes) dependen de las inferiores (estables, optimizadas).

```
  ALTA ABSTRACCION (cambia rapido)
+----------------------------------------------------+
|  INTERFACE LAYER (BFF)                             |
|  views.py / apis.py / urls.py                      |
|  Traduce requests HTTP a llamadas de dominio       |
+------------------------+---------------------------+
                         | (depende de)
+------------------------v---------------------------+
|  APPLICATION LAYER                                 |
|  services.py                                       |
|  Coordina casos de uso (ETL)                       |
|  Orquesta el Pipeline Medallion                    |
+------------------------+---------------------------+
                         | (depende de)
+------------------------v---------------------------+
|  DOMAIN LAYER                                      |
|  models.py                                         |
|  Reglas de negocio y entidades                     |
|  Asset, Portfolio, Price, Quantity                 |
+------------------------+---------------------------+
                         | (depende de)
+------------------------v---------------------------+
|  INFRASTRUCTURE LAYER                              |
|  Django ORM / SQLite                               |
|  Persistencia y comunicacion                       |
+----------------------------------------------------+
  BAJA ABSTRACCION (estable, optimizada)
```

**Beneficios:** Codigo estructurado, equipos especializados por capa, despliegue independiente, las capas sin logica de negocio son reutilizables.

**Aplicacion:** El proyecto separa claramente Interface (`apis.py`/`views.py`), Application (`services.py`), Domain (`models.py`) e Infrastructure (ORM/SQLite). Cada capa tiene responsabilidades distintas y dependencias unidireccionales hacia abajo.

---

### 3. Pipeline

**Estructura:** Un componente por etapa del procesamiento de datos. Flujo unidireccional sin retorno.

```
                 PIPELINE ETL (BATCH)

+----------------+     +----------------+     +----------------+
|    BRONZE      |     |    SILVER      |     |     GOLD       |
|                |     |                |     |                |
| Ingesta        | --> | Transforma     | --> | Agrega         |
| directa        |     | normaliza      |     | precalcula     |
| desde Excel    |     | relaciona      |     | snapshots      |
|                |     |                |     |                |
| Datos crudos   |     | FK a entidades |     | V_t, w_i,t     |
| (CSV)          |     | limpias        |     | listos consumo |
+----------------+     +----------------+     +----------------+
       |                      |                       |
       v                      v                       v
RawWeightIngestion    Asset, Portfolio        PortfolioDailySnapshot
RawPriceIngestion     Price, Quantity         PortfolioAssetSnapshot
```

**Beneficios:** Facil anadir/remplazar etapas, multiples equipos y tecnologias, alta escalabilidad, componentes reutilizables y testeables en aislamiento.

**Aplicacion:** El ETL Medallion es un Pipeline batch de 3 etapas. Cada etapa es una funcion privada (`_etl_ingest_bronze`, `_etl_transform_silver`, `_etl_aggregate_gold`) orquestada por `etl_import_portfolio_data`. Los datos fluyen en una direccion: Excel -> Bronce -> Plata -> Oro.

---

### 4. Shared Repository (Repositorio Compartido)

**Estructura:** Un almacen de datos unico y compartido entre todos los componentes del sistema.

```
+------------------+
|  services.py     |---+
|  (escritura)     |   |
+------------------+   |
                       |
+------------------+   +----------------------------+
|  apis.py         |   |                            |
|  (lectura)       |-->|     SQLite Database        |
+------------------+   |     (db.sqlite3)           |
                       |                            |
+------------------+   +----------------------------+
|  selectors.py    |---+
|  (lectura)       |
+------------------+
```

**Beneficios:** Estado consistente (una sola fuente de verdad), desarrollo simple, sin sobrecarga de red entre componentes.

**Aplicacion:** SQLite como base de datos unica. `services.py` escribe durante el ETL; `apis.py` y `selectors.py` leen durante las consultas del dashboard. Todas las capas acceden al mismo esquema compartido.

---

### 5. CQRS (Command Query Responsibility Segregation)

**Estructura:** Separacion de comandos (operaciones de escritura) y consultas (operaciones de lectura), con modelos posiblemente diferentes.

```
+------------------------------------------------------------------+
|                        COMANDOS                                   |
|                                                                  |
|  services.py                                                     |
|  +-------------------------------------------------------------+ |
|  |  etl_import_portfolio_data()                                | |
|  |    _etl_ingest_bronze()        (INSERT)                     | |
|  |    _etl_transform_silver()     (INSERT, UPDATE)             | |
|  |    _etl_aggregate_gold()       (INSERT)                     | |
|  +-------------------------------------------------------------+ |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
|                        CONSULTAS                                  |
|                                                                  |
|  selectors.py                                                    |
|  +-------------------------------------------------------------+ |
|  |  portfolio_evolution_get()         (SELECT)                  | |
|  |  portfolio_list_get()              (SELECT)                  | |
|  |  portfolio_unit_root_test()        (SELECT + calculo)        | |
|  |  portfolios_cointegration_test()   (SELECT + calculo)        | |
|  +-------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

**Beneficios:** Cada lado puede optimizarse por separado; los modelos de lectura pueden ser desnormalizados para rendimiento.

**Aplicacion:** `services.py` contiene operaciones de escritura (el ETL). `selectors.py` contiene solo consultas de solo-lectura contra los snapshots Gold precalculados. `apis.py` actua como fachada que invoca selectores y serializa la respuesta.

---

### 6. Backends for Frontends (BFF)

**Estructura:** Un backend especifico por tipo de frontend, con APIs disenadas a la medida del cliente.

```
+---------------------------------------------------------+
|              FRONTEND (Cliente)                          |
|  dashboard.js (vanilla JS)                              |
|  ApexCharts / HTML / CSS                                |
|                                                         |
|  +---------------------------------------------------+ |
|  |  fetch(/api/portfolios/*)                         | |
|  +------------------------+--------------------------+ |
+---------------------------+---------------------------+
                            | HTTP
+---------------------------v---------------------------+
|              BFF (Backend for Frontends)               |
|  apis.py                                               |
|  +---------------------------------------------------+ |
|  |  PortfolioListApi                                 | |
|  |  PortfolioEvolutionApi                            | |
|  |  PortfolioEconometricsApi                         | |
|  |  PortfoliosCointegrationApi                       | |
|  +---------------------------------------------------+ |
|  Datos ya formateados para el grafico                  |
+-------------------------------------------------------+
```

**Beneficios:** El frontend no necesita transformar datos; el backend entrega exactamente lo que el dashboard necesita; el frontend y backend evolucionan independientemente.

**Aplicacion:** Los 4 endpoints REST en `apis.py` estan disenados exclusivamente para el dashboard JavaScript. Devuelven KPIs precalculados (`roi`, `mdd`, `volatility`, `sharpe`) y series temporales listas para graficar con ApexCharts. No hay un cliente movil ni de terceros — la API es un BFF puro.

---

## Análisis Exploratorio de Datos

### Estabilidad de Precios de Fines de Semana (Efecto Cierre de Mercado)
Durante la auditoría del comportamiento de la valorización mínima ($V_t$) de los portafolios, se analizó la consistencia de los precios de los activos en los días de fin de semana (sábados y domingos) en relación con el precio del viernes inmediatamente anterior a lo largo de todo el set de datos (`datos.xlsx`):

*   **Días de Fin de Semana Analizados:** 104 días (52 sábados y 52 domingos).
*   **Coincidencia con el Cierre del Viernes:** 104 días coinciden al 100% de manera exacta para todos los activos.
*   **Consistencia:** **100.00%** de estabilidad de precios los fines de semana.

**Conclusión Financiera:**
El dataset de origen (`datos.xlsx`) mantiene la práctica estándar de mercados financieros (donde las cotizaciones permanecen estables durante los cierres semanales replicando el último precio disponible del viernes). Dado que la cantidad de activos en cartera ($c_{i,t}$) es invariable y el precio ($p_{i,t}$) se repite exactamente los sábados y domingos, el valor total del portafolio ($V_t$) es matemáticamente idéntico durante los tres días del bloque del fin de semana (Viernes, Sábado y Domingo).

---

## Licencia

AssetFlow (c) 2026
