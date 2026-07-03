(function() {
    "use strict";

    // 1. Centralización de Endpoints API
    const API_ENDPOINTS = {
        portfolios: () => '/api/portfolios/',
        evolution: (id, start, end) => `/api/portfolios/${id}/evolution/?fecha_inicio=${start}&fecha_fin=${end}`,
        cointegration: (start, end) => `/api/portfolios/cointegration/?fecha_inicio=${start}&fecha_fin=${end}`,
        econometrics: (id, start, end) => `/api/portfolios/${id}/econometrics/?fecha_inicio=${start}&fecha_fin=${end}`,
        etl: () => '/api/maintenance/load-data/',
        difference: (p1, p2, start, end) => `/api/portfolios/comparison-difference/?p1=${p1}&p2=${p2}&fecha_inicio=${start}&fecha_fin=${end}`
    };

    // 2. Caché de Elementos del DOM
    const loader = document.getElementById('loader');
    const portfolioSelect = document.getElementById('portfolio-select');
    const dateStartInput = document.getElementById('date-start');
    const dateEndInput = document.getElementById('date-end');
    const btnUpdate = document.getElementById('btn-update');
    const btnEtl = document.getElementById('btn-etl');
    const btnPdf = document.getElementById('btn-pdf');
    const groupAssetsCheck = document.getElementById('group-assets');
    const showSmaCheck = document.getElementById('show-sma');
    const showMinCheck = document.getElementById('show-min');

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    const kpiRoi = document.getElementById('kpi-roi');
    const kpiMdd = document.getElementById('kpi-mdd');
    const kpiTop = document.getElementById('kpi-top');
    const kpiTopDesc = document.getElementById('kpi-top-desc');
    const kpiTopTitle = document.getElementById('kpi-top-title');

    const adfCardContainer = document.getElementById('adf-card-container');
    const cointBadge = document.getElementById('coint-badge');
    const cointConclusion = document.getElementById('coint-conclusion');
    const valCointStat = document.getElementById('val-coint-stat');
    const valCointP = document.getElementById('val-coint-p');
    const valCointStatus = document.getElementById('val-coint-status');

    // 3. Variables de Estado Privadas
    let valueChart = null;
    let weightsChart = null;
    let weightsChartP1 = null;
    let weightsChartP2 = null;
    let isModalOpen = false;
    let isSimilarExpanded = false;


    let portfoliosData = [];
    let rawEvolutionData = [];
    let rawEvolutionDataP1 = [];
    let rawEvolutionDataP2 = [];
    let differenceData = [];
    let minValuationSingle = null;
    let minValuationP1 = null;
    let minValuationP2 = null;

    const neonColors = [
        '#00f3ff', // EEUU - Electric Cyan
        '#39ff14', // Tesoro - Neon Green
        '#ff007f', // MBS - Hot Pink
        '#cc00ff', // IG Corp - Neon Purple
        '#ff9900', // Europa - Neon Orange
        '#ffe600', // EM Asia - Neon Yellow
        '#475569', // Otros - Cool Slate
        '#00ffb7', '#ff00cc', '#eab308', '#8b5cf6', '#ec4899', '#14b8a6', '#06b6d4', '#f43f5e', '#10b981', '#6b7280'
    ];

    // 4. Utilidades
    function showLoader() { loader.classList.add('active'); }
    function hideLoader() { loader.classList.remove('active'); }

    function timestampToDateStr(timestamp) {
        const d = new Date(timestamp);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // 5. Fábrica de Configuraciones de Gráficos (Chart Options Factory)
    function getBaseChartOptions(chartId, groupId) {
        return {
            chart: {
                id: chartId,
                group: groupId,
                height: '100%',
                foreColor: '#9ca3af',
                background: 'transparent',
                animations: { enabled: false }
            },
            dataLabels: { enabled: false },
            tooltip: {
                theme: 'dark',
                x: { format: 'dd/MM/yyyy' }
            },
            grid: { borderColor: 'rgba(255, 255, 255, 0.04)' }
        };
    }

    // Constructor de opciones específicas para gráficos de valorización
    function getValueChartOptions(chartId, groupId, series, colors, categories) {
        const base = getBaseChartOptions(chartId, groupId);
        
        let tooltipConfig = {
            ...base.tooltip,
            y: { formatter: val => '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2 }) }
        };
        
        // Si estamos en modo comparación, usamos un tooltip personalizado que actualiza el panel dinámico
        if (groupId === 'portfolioGroupCompare') {
            tooltipConfig = {
                ...base.tooltip,
                custom: function({ series: srs, seriesIndex, dataPointIndex, w }) {
                    renderWeightsComparisonTable(dataPointIndex);
                    updateDiffCard(dataPointIndex);
                    drawDiffLine(dataPointIndex, w);
                    
                    const dateVal = w.globals.categoryHeaders[dataPointIndex];
                    const dateStr = new Date(dateVal).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    let html = `<div class="apexcharts-theme-dark" style="padding: 10px;">
                        <div style="font-weight: bold; margin-bottom: 5px; font-size: 0.75rem;">${dateStr}</div>`;
                    
                    srs.forEach((val, idx) => {
                        const name = w.globals.seriesNames[idx];
                        if (name.includes('Tendencia')) return;
                        
                        const color = w.globals.colors[idx];
                        html += `<div style="display: flex; align-items: center; gap: 5px; margin-bottom: 3px; font-size: 0.72rem;">
                            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:${color};"></span>
                            <span>${name}: <strong>$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></span>
                        </div>`;
                    });

                    // Diferencia calculada en backend (vía ORM)
                    if (differenceData && differenceData[dataPointIndex]) {
                        const diffVal = differenceData[dataPointIndex].diferencia;
                        html += `<div style="display: flex; align-items: center; gap: 5px; margin-top: 5px; padding-top: 5px; border-top: 1px dashed rgba(255,255,255,0.15); font-size: 0.72rem; color: #ef4444;">
                            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:#ef4444;"></span>
                            <span>Diferencia: <strong>$${diffVal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></span>
                        </div>`;
                    }

                    html += `</div>`;
                    return html;
                }
            };
        }

        return {
            ...base,
            chart: {
                ...base.chart,
                type: 'area',
                toolbar: {
                    show: true,
                    tools: { download: false, selection: false, zoom: true, zoomin: false, zoomout: false, pan: true, reset: true },
                    autoSelected: 'zoom'
                },
                zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
                events: {
                    zoomed: (ctx, { xaxis }) => { 
                        hideDiffLine();
                        if (xaxis && xaxis.min && xaxis.max) handleChartZoom(xaxis.min, xaxis.max); 
                    },
                    scrolled: (ctx, { xaxis }) => { 
                        hideDiffLine();
                        if (xaxis && xaxis.min && xaxis.max) handleChartZoom(xaxis.min, xaxis.max); 
                    },
                    mouseLeave: function() {
                        renderWeightsComparisonTable();
                        hideDiffLine();
                        const dc = document.getElementById('comparison-diff-card');
                        if (dc) dc.style.display = 'none';
                    }
                }
            },
            series: series,
            colors: colors,
            stroke: {
                curve: 'smooth',
                width: series.map(s => (s.name.includes('Tendencia') || s.name.includes('SMA')) ? 1.2 : 2.5),
                dashArray: series.map(s => (s.name.includes('Tendencia') || s.name.includes('SMA')) ? 4 : 0)
            },
            fill: {
                type: 'gradient',
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: series.map(s => (s.name.includes('Tendencia') || s.name.includes('SMA')) ? 0.02 : 0.3),
                    opacityTo: series.map(s => (s.name.includes('Tendencia') || s.name.includes('SMA')) ? 0.01 : 0.02),
                    stops: [0, 95]
                }
            },
            xaxis: { categories: categories, type: 'datetime', labels: { format: 'dd/MM/yy' } },
            yaxis: { labels: { formatter: val => '$' + (val / 1e6).toFixed(1) + 'M' } },
            tooltip: tooltipConfig,
            legend: groupId === 'portfolioGroupCompare' ? {
                position: 'top',
                horizontalAlign: 'left',
                offsetY: -5,
                labels: { colors: '#9ca3af' },
                markers: { radius: 2, offsetY: 0 }
            } : { show: false },
            grid: { borderColor: 'rgba(255, 255, 255, 0.04)' }
        };
    }

    // Constructor de opciones para gráficos de pesos
    function getWeightsChartOptions(chartId, groupId, series, categories, showLegend = false) {
        const base = getBaseChartOptions(chartId, groupId);
        
        let tooltipConfig = {
            ...base.tooltip,
            y: { formatter: val => val.toFixed(2) + '%' }
        };
        
        // Si es modo comparación (sin leyenda lateral), desactivamos el tooltip nativo
        // y habilitamos la renderización en el panel dinámico inferior
        if (!showLegend) {
            tooltipConfig = {
                enabled: true,
                custom: function({ series: srs, seriesIndex, dataPointIndex, w }) {
                    renderWeightsComparisonTable(dataPointIndex);
                    return '<div style="display:none;"></div>';
                }
            };
        }

        return {
            ...base,
            chart: {
                ...base.chart,
                type: 'area',
                stacked: true,
                toolbar: { show: false },
                events: {
                    mouseLeave: function() {
                        renderWeightsComparisonTable();
                    }
                }
            },
            colors: neonColors,
            series: series,
            stroke: { curve: 'smooth', width: showLegend ? 1.5 : 1.2 },
            xaxis: { categories: categories, type: 'datetime', labels: { format: 'dd/MM/yy' } },
            yaxis: { max: 100, labels: { formatter: val => val.toFixed(0) + '%' } },
            fill: { type: 'solid', opacity: showLegend ? 0.3 : 0.25 },
            legend: showLegend ? {
                position: 'right',
                offsetY: 0,
                height: 250,
                markers: { radius: 12 }
            } : { show: false },
            tooltip: tooltipConfig,
            grid: { borderColor: showLegend ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.03)' }
        };
    }

    // 6. Manejo de Zoom
    function handleChartZoom(minTimestamp, maxTimestamp) {
        if (!minTimestamp || !maxTimestamp) return;

        const startStr = timestampToDateStr(minTimestamp);
        const endStr = timestampToDateStr(maxTimestamp);

        // Actualizar inputs del navbar
        dateStartInput.value = startStr;
        dateEndInput.value = endStr;

        const selectedVal = portfolioSelect.value;
        const isCompare = (selectedVal === 'compare');

        if (isCompare) {
            if (rawEvolutionDataP1.length === 0 || rawEvolutionDataP2.length === 0) return;
            const filteredP1 = rawEvolutionDataP1.filter(item => item.fecha >= startStr && item.fecha <= endStr);
            const filteredP2 = rawEvolutionDataP2.filter(item => item.fecha >= startStr && item.fecha <= endStr);
            if (filteredP1.length > 0 && filteredP2.length > 0) {
                calculateComparativeKPIs(filteredP1, filteredP2, true);
            }
        } else {
            if (rawEvolutionData.length === 0) return;
            const filteredData = rawEvolutionData.filter(item => item.fecha >= startStr && item.fecha <= endStr);
            if (filteredData.length > 0) {
                calculateFinancialKPIs(filteredData);
            }
        }
    }

    // 7. Tabs de Navegación
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');

            if (tabId === 'tab-evolution') {
                if (valueChart) valueChart.windowResize();
                if (weightsChart) weightsChart.windowResize();
                if (weightsChartP1) weightsChartP1.windowResize();
                if (weightsChartP2) weightsChartP2.windowResize();
            }
        });
    });

    // 8. Inicialización
    window.addEventListener('DOMContentLoaded', async () => {
        showLoader();
        try {
            const res = await fetch(API_ENDPOINTS.portfolios());
            portfoliosData = await res.json();
            
            if (portfoliosData.length === 0) {
                alert('No se encontraron portafolios. Ejecuta la carga ETL.');
                hideLoader();
                return;
            }

            portfoliosData.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                portfolioSelect.appendChild(opt);
            });

            const optCompare = document.createElement('option');
            optCompare.value = 'compare';
            optCompare.textContent = 'Comparar Ambos';
            portfolioSelect.appendChild(optCompare);

            setupDateLimits(portfoliosData[0]);
            await loadChartAndEconometricData();
        } catch (err) {
            console.error(err);
            alert('Error de inicialización:\n' + err.message + '\n\nSi el proyecto se acaba de clonar, por favor haga clic en "Procesar ETL" para configurar la base de datos e importar la información inicial.');
        } finally {
            hideLoader();
        }
    });

    portfolioSelect.addEventListener('change', () => {
        const selectedVal = portfolioSelect.value;
        if (selectedVal === 'compare') {
            setupDateLimits(portfoliosData[0]);
        } else {
            const selectedId = parseInt(selectedVal);
            const portfolio = portfoliosData.find(p => p.id === selectedId);
            if (portfolio) {
                setupDateLimits(portfolio);
            }
        }
        // Auto-actualizar el dashboard al seleccionar otra opción
        btnUpdate.click();
    });

    btnUpdate.addEventListener('click', async () => {
        showLoader();
        await loadChartAndEconometricData();
        hideLoader();
    });

    btnEtl.addEventListener('click', async () => {
        if (!confirm("¿Está seguro de que desea ejecutar las migraciones y recargar los datos desde 'datos.xlsx'?\n\nEsto re-creará la base de datos local e importará la información fresca. El proceso puede tomar unos segundos.")) {
            return;
        }
        showLoader();
        try {
            const res = await fetch(API_ENDPOINTS.etl(), {
                method: 'POST'
            });
            const data = await res.json();
            if (res.ok && data.status === 'success') {
                alert(data.message);
                window.location.reload();
            } else {
                alert('Error al ejecutar ETL:\n' + (data.message || 'Error desconocido'));
            }
        } catch (err) {
            console.error(err);
            alert('Ocurrió un error al intentar conectarse al servidor:\n' + err.message);
        } finally {
            hideLoader();
        }
    });

    showSmaCheck.addEventListener('change', () => {
        const isCompare = (portfolioSelect.value === 'compare');
        if (isCompare) {
            if (rawEvolutionDataP1.length > 0 && rawEvolutionDataP2.length > 0) {
                renderOverlaidValueChart(rawEvolutionDataP1, rawEvolutionDataP2);
            }
        } else {
            if (rawEvolutionData.length > 0) renderValueChart(rawEvolutionData);
        }
    });

    showMinCheck.addEventListener('change', () => {
        const isCompare = (portfolioSelect.value === 'compare');
        if (isCompare) {
            if (rawEvolutionDataP1.length > 0 && rawEvolutionDataP2.length > 0) {
                renderOverlaidValueChart(rawEvolutionDataP1, rawEvolutionDataP2);
            }
        } else {
            if (rawEvolutionData.length > 0) renderValueChart(rawEvolutionData);
        }
    });

    groupAssetsCheck.addEventListener('change', () => {
        const isCompare = (portfolioSelect.value === 'compare');
        if (isCompare) {
            if (isModalOpen && rawEvolutionDataP1.length > 0 && rawEvolutionDataP2.length > 0) {
                renderCompareWeightsCharts(rawEvolutionDataP1, rawEvolutionDataP2);
            }
        } else {
            if (rawEvolutionData.length > 0) renderWeightsChart(rawEvolutionData);
        }
    });

    btnPdf.addEventListener('click', () => {
        window.print();
    });

    function setupDateLimits(portfolio) {
        dateStartInput.min = portfolio.min_date;
        dateStartInput.max = portfolio.max_date;
        dateEndInput.min = portfolio.min_date;
        dateEndInput.max = portfolio.max_date;
        dateStartInput.value = portfolio.min_date;
        dateEndInput.value = portfolio.max_date;
    }

    function renderWeightsComparisonTable(dataPointIndex = null) {
        const containerId = isModalOpen ? 'modal-weights-shared-legend' : 'weights-shared-legend';
        const legendEl = document.getElementById(containerId);
        if (!legendEl) return;

        const isCompare = (portfolioSelect.value === 'compare');
        if (!isCompare) return;

        const p1 = rawEvolutionDataP1;
        const p2 = rawEvolutionDataP2;
        if (!p1 || p1.length === 0 || !p2 || p2.length === 0) return;

        let titleStr = "Composición Promedio del Período";
        let showAverage = (dataPointIndex === null || dataPointIndex < 0 || dataPointIndex >= p1.length);

        if (!showAverage && dataPointIndex >= 0 && dataPointIndex < p1.length) {
            const dateStr = p1[dataPointIndex].fecha;
            const parts = dateStr.split('-');
            titleStr = `Composición al ${parts[2]}/${parts[1]}/${parts[0]}`;
        }

        // Obtener la lista de activos
        const assetNames = Object.keys(p1[0].pesos);
        
        // Calcular pesos
        const weightsData = [];
        assetNames.forEach(name => {
            let w1, w2;
            if (showAverage) {
                const sum1 = p1.reduce((acc, item) => acc + item.pesos[name], 0);
                const sum2 = p2.reduce((acc, item) => acc + item.pesos[name], 0);
                w1 = sum1 / p1.length;
                w2 = sum2 / p2.length;
            } else {
                w1 = p1[dataPointIndex].pesos[name] || 0;
                w2 = p2[dataPointIndex].pesos[name] || 0;
            }
            const diff = w1 - w2;
            weightsData.push({ name, w1, w2, diff });
        });

        // Separar activos por estrategia
        const p1Over = [];
        const p2Over = [];
        const neutral = [];

        weightsData.forEach(item => {
            if (item.diff >= 0.01) {
                p1Over.push(item);
            } else if (item.diff <= -0.01) {
                p2Over.push(item);
            } else {
                neutral.push(item);
            }
        });

        // Ordenar cada grupo
        p1Over.sort((a, b) => b.diff - a.diff); // De mayor a menor sesgo P1
        p2Over.sort((a, b) => a.diff - b.diff); // De mayor a menor sesgo P2 (más negativo primero)
        neutral.sort((a, b) => (b.w1 + b.w2) - (a.w1 + a.w2)); // Por peso promedio total

        // Helper para renderizar cada tarjeta individual con color consistente
        const renderAssetCard = (item) => {
            const originalIdx = assetNames.indexOf(item.name);
            const color = neonColors[originalIdx % neonColors.length];
            const p1Percent = (item.w1 * 100).toFixed(2) + '%';
            const p2Percent = (item.w2 * 100).toFixed(2) + '%';
            const diffVal = item.diff * 100;
            let diffText = '';
            let diffColor = 'var(--text-muted)';
            
            if (diffVal > 0.005) {
                diffText = `+${diffVal.toFixed(2)}%`;
                diffColor = '#00f3ff'; // Cian
            } else if (diffVal < -0.005) {
                diffText = `${diffVal.toFixed(2)}%`;
                diffColor = '#cc00ff'; // Púrpura
            } else {
                diffText = '0.00%';
            }

            return `
                <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.04); border-radius: 5px; padding: 0.35rem 0.5rem; display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;">
                    <div style="display: flex; align-items: center; gap: 0.35rem; min-width: 0; flex: 1;">
                        <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background-color:${color}; box-shadow: 0 0 4px ${color}80; flex-shrink: 0;"></span>
                        <span style="font-size: 0.68rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500;">${item.name}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.45rem; font-family: 'JetBrains Mono', monospace; font-size: 0.68rem; font-weight: 500; flex-shrink: 0;">
                        <span style="color: #00f3ff;" title="Peso en Portafolio 1">${p1Percent}</span>
                        <span style="color: var(--text-muted); font-size: 0.6rem;">/</span>
                        <span style="color: #cc00ff;" title="Peso en Portafolio 2">${p2Percent}</span>
                        <span style="color: ${diffColor}; font-size: 0.65rem; font-weight: 600; min-width: 40px; text-align: right;" title="Diferencia (P1 - P2)">${diffText}</span>
                    </div>
                </div>
            `;
        };

        const p1OverHTML = p1Over.length > 0 
            ? p1Over.map(item => renderAssetCard(item)).join('')
            : '<div style="font-size: 0.68rem; color: var(--text-muted); font-style: italic; padding: 0.25rem;">Ningún activo</div>';

        const p2OverHTML = p2Over.length > 0 
            ? p2Over.map(item => renderAssetCard(item)).join('')
            : '<div style="font-size: 0.68rem; color: var(--text-muted); font-style: italic; padding: 0.25rem;">Ningún activo</div>';

        const neutralHTML = neutral.length > 0 
            ? neutral.map(item => renderAssetCard(item)).join('')
            : '<div style="font-size: 0.68rem; color: var(--text-muted); font-style: italic; padding: 0.25rem; grid-column: span 2;">Ningún activo</div>';

        // Construir la estructura completa
        let html = `
            <div style="width: 100%; display: flex; flex-direction: column; gap: 0.4rem; padding: 0.4rem 0.6rem;">
                <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.15rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 0.2rem;">
                    <span>${titleStr}</span>
                    <span style="font-size: 0.62rem; color: #94a3b8; text-transform: none; font-weight: 400;">
                        ${showAverage ? 'Desplace el cursor sobre los gráficos para ver datos diarios' : 'Valores en el punto hovered'}
                    </span>
                </div>
                
                <div style="display: flex; flex-direction: row; gap: 0.75rem; width: 100%;">
                    <!-- Columna P1 Over -->
                    <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem;">
                        <div style="font-size: 0.68rem; font-weight: 700; color: #00f3ff; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid rgba(0, 243, 255, 0.12); padding-bottom: 0.15rem; margin-bottom: 0.2rem; display: flex; justify-content: space-between;">
                            <span>Sobreponderados en P1</span>
                            <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.65rem;">(${p1Over.length})</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 0.3rem; max-height: 110px; overflow-y: auto;">
                            ${p1OverHTML}
                        </div>
                    </div>
                    
                    <!-- Columna P2 Over -->
                    <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem;">
                        <div style="font-size: 0.68rem; font-weight: 700; color: #cc00ff; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid rgba(204, 0, 255, 0.12); padding-bottom: 0.15rem; margin-bottom: 0.2rem; display: flex; justify-content: space-between;">
                            <span>Sobreponderados en P2</span>
                            <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.65rem;">(${p2Over.length})</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 0.3rem; max-height: 110px; overflow-y: auto;">
                            ${p2OverHTML}
                        </div>
                    </div>
                </div>

                <!-- Acordeón para activos similares -->
                <div style="margin-top: 0.3rem; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 0.3rem;">
                    <button id="btn-toggle-similar" style="width: 100%; justify-content: space-between; font-size: 0.68rem; padding: 0.25rem 0.4rem; background: rgba(255, 255, 255, 0.01); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 4px; color: var(--text-secondary); display: flex; align-items: center; cursor: pointer; transition: background 0.15s;">
                        <span style="font-weight: 600;">${isSimilarExpanded ? '▼' : '►'} Activos con asignaciones similares (diferencia < 1.0%) (${neutral.length})</span>
                        <span style="font-size: 0.6rem; color: var(--text-muted);">${isSimilarExpanded ? 'Ocultar' : 'Mostrar'}</span>
                    </button>
                    <div id="similar-assets-panel" style="display: ${isSimilarExpanded ? 'grid' : 'none'}; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 0.3rem; margin-top: 0.3rem; max-height: 90px; overflow-y: auto; padding: 0.1rem;">
                        ${neutralHTML}
                    </div>
                </div>
            </div>
        `;

        legendEl.innerHTML = html;

        // Vincular el acordeón
        const toggleBtn = legendEl.querySelector('#btn-toggle-similar');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                isSimilarExpanded = !isSimilarExpanded;
                renderWeightsComparisonTable(dataPointIndex);
            });
        }
    }

    function getWeightsSeries(data, groupEnabled) {
        const assetNames = Object.keys(data[0].pesos);
        let series = [];

        if (groupEnabled) {
            const averageWeights = {};
            assetNames.forEach(name => {
                const sum = data.reduce((acc, item) => acc + item.pesos[name], 0);
                averageWeights[name] = sum / data.length;
            });

            const sortedAssets = Object.keys(averageWeights).sort((a, b) => averageWeights[b] - averageWeights[a]);
            const topAssets = sortedAssets.slice(0, 6);
            const minorAssets = sortedAssets.slice(6);

            topAssets.forEach(name => {
                series.push({
                    name: name,
                    data: data.map(item => parseFloat((item.pesos[name] * 100).toFixed(3)))
                });
            });

            const otrosData = data.map(item => {
                const sumMinor = minorAssets.reduce((acc, name) => acc + item.pesos[name], 0);
                return parseFloat((sumMinor * 100).toFixed(3));
            });

            series.push({
                name: 'Otros activos',
                data: otrosData
            });
        } else {
            series = assetNames.map(name => {
                return {
                    name: name,
                    data: data.map(item => parseFloat((item.pesos[name] * 100).toFixed(3)))
                };
            });
        }
        return series;
    }

    function renderCompareWeightsCharts(p1, p2) {
        if (weightsChartP1) {
            try { weightsChartP1.destroy(); } catch(e){}
            weightsChartP1 = null;
        }
        if (weightsChartP2) {
            try { weightsChartP2.destroy(); } catch(e){}
            weightsChartP2 = null;
        }

        const categories = p1.map(item => item.fecha);
        const series1 = getWeightsSeries(p1, groupAssetsCheck.checked);
        const series2 = getWeightsSeries(p2, groupAssetsCheck.checked);

        // Renderizar tabla dinámica comparativa en promedio por defecto
        renderWeightsComparisonTable();

        // Gráficos de área apilados individuales compartiendo el mismo grupo de sincronización
        const options1 = getWeightsChartOptions('weightsChartP1', 'portfolioGroupCompare', series1, categories, false);
        const options2 = getWeightsChartOptions('weightsChartP2', 'portfolioGroupCompare', series2, categories, false);

        const chartEl1 = document.querySelector("#modal-weights-chart-p1");
        const chartEl2 = document.querySelector("#modal-weights-chart-p2");

        if (chartEl1 && chartEl2) {
            chartEl1.innerHTML = '';
            chartEl2.innerHTML = '';
            weightsChartP1 = new ApexCharts(chartEl1, options1);
            weightsChartP1.render();
            weightsChartP2 = new ApexCharts(chartEl2, options2);
            weightsChartP2.render();
        }
    }

    function createWeightsCompareModal() {
        let modal = document.getElementById('weights-compare-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'weights-compare-modal';
            modal.className = 'modal-overlay';
            // Estilos críticos inline para el overlay
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100vw';
            modal.style.height = '100vh';
            modal.style.background = 'rgba(3, 7, 18, 0.85)';
            modal.style.backdropFilter = 'blur(12px)';
            modal.style.webkitBackdropFilter = 'blur(12px)';
            modal.style.zIndex = '1000';
            modal.style.display = 'flex';
            modal.style.alignItems = 'center';
            modal.style.justifyContent = 'center';
            modal.style.opacity = '0';
            modal.style.pointerEvents = 'none';
            modal.style.transition = 'opacity 0.2s ease, transform 0.2s ease';

            modal.innerHTML = `
                <div class="modal-container" style="width: 92vw; height: 85vh; background: #090d16; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; display: flex; flex-direction: column; padding: 1.25rem; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.85); transform: scale(0.96); transition: transform 0.2s ease-out; min-height: 0;">
                    <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 0.6rem; border-bottom: 1px solid rgba(255, 255, 255, 0.05); flex-shrink: 0;">
                        <h2 style="font-size: 1.05rem; font-weight: 600; margin: 0; background: linear-gradient(to right, #60a5fa, #34d399); -webkit-background-clip: text; -webkit-text-fill-color: transparent; border-left: 3px solid var(--accent-solid); padding-left: 0.5rem;">Comparación Detallada de Composición (w_i,t)</h2>
                        <button class="modal-close-btn" id="modal-close-btn" style="background: transparent; border: none; color: var(--text-secondary); font-size: 1.6rem; font-weight: 300; cursor: pointer; line-height: 1; padding: 0.1rem 0.4rem; transition: color 0.15s;">&times;</button>
                    </div>
                    <div class="modal-body" style="flex-grow: 1; display: flex; flex-direction: column; gap: 0.75rem; min-height: 0; margin-top: 0.5rem;">
                        <div class="modal-charts-row" style="display: flex; flex-direction: row; gap: 0.75rem; height: 60%; flex-shrink: 0; min-height: 0;">
                            <div class="modal-chart-col" style="flex: 1; display: flex; flex-direction: column; height: 100%; min-width: 0; background: rgba(255, 255, 255, 0.01); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 8px; padding: 0.5rem;">
                                <div class="modal-chart-title modal-p1-title" style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; text-align: center; margin-bottom: 2px; color: #00f3ff;">Portafolio 1</div>
                                <div id="modal-weights-chart-p1" class="modal-chart-viewport" style="width: 100%; height: calc(100% - 15px);"></div>
                            </div>
                            <div class="modal-chart-col" style="flex: 1; display: flex; flex-direction: column; height: 100%; min-width: 0; background: rgba(255, 255, 255, 0.01); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 8px; padding: 0.5rem;">
                                <div class="modal-chart-title modal-p2-title" style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; text-align: center; margin-bottom: 2px; color: #cc00ff;">Portafolio 2</div>
                                <div id="modal-weights-chart-p2" class="modal-chart-viewport" style="width: 100%; height: calc(100% - 15px);"></div>
                            </div>
                        </div>
                        <div id="modal-weights-shared-legend" class="modal-legend-container" style="flex-grow: 1; height: auto; min-height: 0; overflow-y: auto; background: rgba(255, 255, 255, 0.01); border-top: 1px solid rgba(255, 255, 255, 0.03);"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            modal.querySelector('#modal-close-btn').addEventListener('click', closeWeightsCompareModal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeWeightsCompareModal();
            });
        }
    }

    function openWeightsCompareModal() {
        createWeightsCompareModal();
        const modal = document.getElementById('weights-compare-modal');
        if (modal) {
            modal.style.opacity = '1';
            modal.style.pointerEvents = 'all';
            const container = modal.querySelector('.modal-container');
            if (container) {
                container.style.transform = 'scale(1)';
            }
            isModalOpen = true;
            renderCompareWeightsCharts(rawEvolutionDataP1, rawEvolutionDataP2);
        }
    }

    function closeWeightsCompareModal() {
        const modal = document.getElementById('weights-compare-modal');
        if (modal) {
            modal.style.opacity = '0';
            modal.style.pointerEvents = 'none';
            const container = modal.querySelector('.modal-container');
            if (container) {
                container.style.transform = 'scale(0.96)';
            }
            isModalOpen = false;
            
            // Destruir gráficos para liberar recursos
            if (weightsChartP1) {
                try { weightsChartP1.destroy(); } catch(e){}
                weightsChartP1 = null;
            }
            if (weightsChartP2) {
                try { weightsChartP2.destroy(); } catch(e){}
                weightsChartP2 = null;
            }
        }
    }

    function setupWeightsChartContainers(isCompare) {
        const container = document.getElementById('weights-chart-container');
        const titleEl = document.getElementById('weights-chart-title');
        
        if (isCompare) {
            titleEl.textContent = "Comparativa de Pesos de Activos (w_i,t)";
            if (weightsChart) {
                try { weightsChart.destroy(); } catch(e){}
                weightsChart = null;
            }
            container.classList.add('compare-mode');
            container.innerHTML = `
                <div class="weights-compare-inactive-card" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; height: 100%; width: 100%; padding: 1.5rem; background: rgba(17, 24, 39, 0.2); border-radius: 8px; gap: 0.6rem;">
                    <svg class="inactive-icon" style="width: 38px; height: 38px; stroke: var(--text-muted); opacity: 0.6; margin-bottom: 0.25rem; fill: none;" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path d="M3 3v18h18M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/>
                    </svg>
                    <h3 style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary); margin: 0;">Comparación de Composición de Activos</h3>
                    <p style="font-size: 0.76rem; color: var(--text-secondary); max-width: 260px; line-height: 1.4; margin: 0;">Analice la evolución de la distribución de pesos de ambos portafolios en paralelo a pantalla completa.</p>
                    <button class="btn btn-primary" id="btn-expand-weights" style="margin-top: 0.5rem; display: flex; align-items: center; gap: 6px;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" style="width: 14px; height: 14px;">
                            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                        </svg>
                        Expandir Comparativa
                    </button>
                </div>
            `;
            // Asociar click
            document.getElementById('btn-expand-weights').addEventListener('click', openWeightsCompareModal);
        } else {
            titleEl.textContent = "Distribución de Pesos de Activos (w_i,t)";
            if (weightsChartP1) {
                try { weightsChartP1.destroy(); } catch(e){}
                weightsChartP1 = null;
            }
            if (weightsChartP2) {
                try { weightsChartP2.destroy(); } catch(e){}
                weightsChartP2 = null;
            }
            container.classList.remove('compare-mode');
            container.innerHTML = `<div id="weights-chart" style="width: 100%; height: 100%;"></div>`;
        }
    }

    async function loadChartAndEconometricData() {
        const selectedVal = portfolioSelect.value;
        const start = dateStartInput.value;
        const end = dateEndInput.value;

        if (!start || !end) return;

        const isCompare = (selectedVal === 'compare');

        if (isCompare) {
            try {
                const results = await Promise.all([
                    fetch(API_ENDPOINTS.evolution(1, start, end)).then(r => { if (!r.ok) throw new Error('Error al obtener P1'); return r.json(); }),
                    fetch(API_ENDPOINTS.evolution(2, start, end)).then(r => { if (!r.ok) throw new Error('Error al obtener P2'); return r.json(); }),
                    fetch(API_ENDPOINTS.difference(1, 2, start, end)).then(r => { if (!r.ok) throw new Error('Error al obtener diferencia'); return r.json(); })
                ]);
                const dataP1 = results[0];
                const dataP2 = results[1];
                const dataDiff = results[2];
                rawEvolutionDataP1 = dataP1.series;
                rawEvolutionDataP2 = dataP2.series;
                minValuationP1 = dataP1.min_valuation;
                minValuationP2 = dataP2.min_valuation;
                differenceData = dataDiff;
                updateDiffCard();

                if (rawEvolutionDataP1.length === 0 || rawEvolutionDataP2.length === 0) {
                    alert('No se encontraron registros en el rango seleccionado.');
                    return;
                }

                setupWeightsChartContainers(true);
                calculateComparativeKPIs(dataP1.kpis, dataP2.kpis, false);
                await fetchComparativeEconometrics(start, end);
                
                renderOverlaidValueChart(rawEvolutionDataP1, rawEvolutionDataP2);
                if (isModalOpen) {
                    renderCompareWeightsCharts(rawEvolutionDataP1, rawEvolutionDataP2);
                }
            } catch (err) {
                console.error(err);
            }
        } else {
            try {
                differenceData = [];
                updateDiffCard();
                const evolutionRes = await fetch(API_ENDPOINTS.evolution(selectedVal, start, end));
                if (!evolutionRes.ok) throw new Error('Error al obtener evolucion del portafolio');
                const data = await evolutionRes.json();
                rawEvolutionData = data.series;
                minValuationSingle = data.min_valuation;

                if (rawEvolutionData.length === 0) {
                    alert('No se encontraron registros.');
                    return;
                }

                setupWeightsChartContainers(false);
                calculateFinancialKPIs(data.kpis, rawEvolutionData);
                await fetchSingleEconometrics(selectedVal, start, end);
                
                renderValueChart(rawEvolutionData);
                renderWeightsChart(rawEvolutionData);
            } catch (err) {
                console.error(err);
            }
        }
    }

    function calculateVolatilityAndSharpe(data) {
        if (!data || data.length < 2) return { vol: 0, sharpe: 0 };
        const values = data.map(item => parseFloat(item.valor_total));
        const returns = [];
        for (let i = 1; i < values.length; i++) {
            const prev = values[i - 1];
            returns.push(prev !== 0 ? (values[i] - prev) / prev : 0.0);
        }
        if (returns.length < 2) return { vol: 0, sharpe: 0 };
        
        const mean = returns.reduce((acc, val) => acc + val, 0) / returns.length;
        const variance = returns.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (returns.length - 1);
        const stdev = Math.sqrt(variance);
        
        const volAnual = stdev * Math.sqrt(252) * 100;
        
        const vInit = values[0];
        const vFinal = values[values.length - 1];
        const totalReturn = vInit !== 0 ? (vFinal - vInit) / vInit : 0;
        
        const rf = 0.03;
        const sharpe = stdev !== 0 ? (totalReturn - rf) / (stdev * Math.sqrt(252)) : 0;
        
        return { vol: volAnual, sharpe: sharpe };
    }

    function calculateFinancialKPIs(kpisOrData, dataFallback = null) {
        let roi, mdd, starAsset, starAssetReturn;
        
        if (dataFallback === null) {
            const data = kpisOrData;
            if (!data || data.length === 0) return;
            const vInit = parseFloat(data[0].valor_total);
            const vFinal = parseFloat(data[data.length - 1].valor_total);

            roi = ((vFinal - vInit) / vInit) * 100;
            
            let peak = -Infinity;
            let maxDD = 0;
            data.forEach(item => {
                const val = parseFloat(item.valor_total);
                if (val > peak) peak = val;
                const dd = ((peak - val) / peak) * 100;
                if (dd > maxDD) maxDD = dd;
            });
            mdd = maxDD;

            const assetNames = Object.keys(data[0].pesos);
            let topAsset = "";
            let topReturn = -Infinity;
            assetNames.forEach(name => {
                const wInit = data[0].pesos[name];
                const wFinal = data[data.length - 1].pesos[name];
                if (wInit > 0) {
                    const assetInitVal = wInit * vInit;
                    const assetFinalVal = wFinal * vFinal;
                    const assetReturn = ((assetFinalVal - assetInitVal) / assetInitVal) * 100;
                    if (assetReturn > topReturn) {
                        topReturn = assetReturn;
                        topAsset = name;
                    }
                }
            });
            starAsset = topAsset;
            starAssetReturn = topReturn;
            dataFallback = data;
        } else {
            // Métricas precalculadas del backend
            roi = kpisOrData.roi;
            mdd = kpisOrData.mdd;
            starAsset = kpisOrData.star_asset;
            starAssetReturn = kpisOrData.star_asset_return;
        }

        kpiRoi.innerHTML = (roi >= 0 ? '+' : '') + roi.toFixed(2) + '%';
        kpiRoi.style.color = roi >= 0 ? '#10b981' : '#ef4444';

        kpiMdd.innerHTML = '-' + mdd.toFixed(2) + '%';

        kpiTopTitle.innerHTML = `Activo Estrella <span class="help-tooltip" data-tooltip="Fórmula: ((w_final * V_final) / (w_initial * V_initial) - 1) * 100. El activo con el mayor rendimiento individual en su precio cotizado durante el período.">?</span>`;
        
        const formatDate = (dateStr) => {
            const parts = dateStr.split('-');
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        };

        if (starAsset) {
            kpiTop.textContent = starAsset;
            kpiTopDesc.textContent = `Retorno: ${starAssetReturn >= 0 ? '+' : ''}${starAssetReturn.toFixed(2)}% (${formatDate(dataFallback[0].fecha)} - ${formatDate(dataFallback[dataFallback.length - 1].fecha)})`;
        } else {
            kpiTop.textContent = '---';
            kpiTopDesc.textContent = 'Sin datos';
        }
    }

    function calculateComparativeKPIs(p1OrKpis1, p2OrKpis2, isZoom = false) {
        let roi1, roi2, maxDD1, maxDD2, stats1, stats2;

        if (isZoom) {
            // Cálculo local (en zoom)
            const p1 = p1OrKpis1;
            const p2 = p2OrKpis2;
            const vInit1 = parseFloat(p1[0].valor_total);
            const vFinal1 = parseFloat(p1[p1.length - 1].valor_total);
            const vInit2 = parseFloat(p2[0].valor_total);
            const vFinal2 = parseFloat(p2[p2.length - 1].valor_total);

            roi1 = ((vFinal1 - vInit1) / vInit1) * 100;
            roi2 = ((vFinal2 - vInit2) / vInit2) * 100;

            let peak1 = -Infinity;
            maxDD1 = 0;
            p1.forEach(item => {
                const val = parseFloat(item.valor_total);
                if (val > peak1) peak1 = val;
                const dd = ((peak1 - val) / peak1) * 100;
                if (dd > maxDD1) maxDD1 = dd;
            });
            let peak2 = -Infinity;
            maxDD2 = 0;
            p2.forEach(item => {
                const val = parseFloat(item.valor_total);
                if (val > peak2) peak2 = val;
                const dd = ((peak2 - val) / peak2) * 100;
                if (dd > maxDD2) maxDD2 = dd;
            });

            const s1 = calculateVolatilityAndSharpe(p1);
            const s2 = calculateVolatilityAndSharpe(p2);
            stats1 = { volatility: s1.vol, sharpe: s1.sharpe };
            stats2 = { volatility: s2.vol, sharpe: s2.sharpe };
        } else {
            // Métricas precalculadas del backend
            const kpis1 = p1OrKpis1;
            const kpis2 = p2OrKpis2;
            roi1 = kpis1.roi;
            roi2 = kpis2.roi;
            maxDD1 = kpis1.mdd;
            maxDD2 = kpis2.mdd;
            stats1 = kpis1;
            stats2 = kpis2;
        }

        kpiRoi.innerHTML = `
            <div style="font-size: 1.1rem; line-height: 1.3; font-weight: 600;">
                P1: <span style="color:${roi1 >= 0 ? '#10b981' : '#ef4444'}">${roi1 >= 0 ? '+' : ''}${roi1.toFixed(2)}%</span><br>
                P2: <span style="color:${roi2 >= 0 ? '#10b981' : '#ef4444'}">${roi2 >= 0 ? '+' : ''}${roi2.toFixed(2)}%</span>
            </div>
        `;

        kpiMdd.innerHTML = `
            <div style="font-size: 1.1rem; line-height: 1.3; font-weight: 600;">
                P1: <span style="color:#ef4444;">-${maxDD1.toFixed(2)}%</span><br>
                P2: <span style="color:#ef4444;">-${maxDD2.toFixed(2)}%</span>
            </div>
        `;

        kpiTopTitle.innerHTML = `Volatilidad / Sharpe <span class="help-tooltip" data-tooltip="La volatilidad mide el riesgo anualizado de los retornos diarios. El Ratio de Sharpe ajusta el retorno neto del período restando la tasa libre de riesgo (3%) por unidad de volatilidad.">?</span>`;
        
        kpiTop.innerHTML = `
            <div style="font-size: 1.05rem; line-height: 1.3; font-weight: 600;">
                P1: <span style="color:#f59e0b;">${stats1.volatility.toFixed(1)}% (${stats1.sharpe >= 0 ? '+' : ''}${stats1.sharpe.toFixed(2)})</span><br>
                P2: <span style="color:#f59e0b;">${stats2.volatility.toFixed(1)}% (${stats2.sharpe >= 0 ? '+' : ''}${stats2.sharpe.toFixed(2)})</span>
            </div>
        `;
        kpiTopDesc.textContent = "Volatilidad anualizada (Ratio Sharpe)";
    }

    async function fetchSingleEconometrics(portfolioId, start, end) {
        try {
            adfCardContainer.innerHTML = `
                <div class="econometric-card-header">
                    <h2>Análisis de Tendencia (ADF + KPSS)</h2>
                    <span class="badge" id="adf-badge">---</span>
                </div>
                <p id="adf-conclusion" style="font-size: 0.72rem; line-height: 1.35; margin-bottom: 0.5rem; min-height: 2.7rem;">Cargando análisis confirmatorio de tendencia...</p>
                <div class="econometric-table-wrapper">
                    <table class="econometric-table double-table" style="width: 100%; border-collapse: collapse; font-size: 0.72rem;">
                        <thead>
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.08); text-align: left;">
                                <th style="padding: 0.3rem 0; font-weight: 600; color: var(--text-muted);">Estadística</th>
                                <th style="padding: 0.3rem 0; font-weight: 600; color: #00f3ff; text-align: right;">ADF (Raíz U.)</th>
                                <th style="padding: 0.3rem 0; font-weight: 600; color: #fbbf24; text-align: right;">KPSS (Estac.)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="label" style="padding: 0.25rem 0;">Estadístico del Test</td>
                                <td class="value" id="val-adf-stat" style="text-align: right; font-weight: 600; font-family: monospace;">---</td>
                                <td class="value" id="val-kpss-stat" style="text-align: right; font-weight: 600; font-family: monospace;">---</td>
                            </tr>
                            <tr>
                                <td class="label" style="padding: 0.25rem 0;">p-valor</td>
                                <td class="value" id="val-adf-p" style="text-align: right; font-family: monospace;">---</td>
                                <td class="value" id="val-kpss-p" style="text-align: right; font-family: monospace;">---</td>
                            </tr>
                            <tr>
                                <td class="label" style="padding: 0.25rem 0;">Valor Crítico (1%)</td>
                                <td class="value" id="val-adf-crit-1" style="text-align: right; font-family: monospace;">---</td>
                                <td class="value" id="val-kpss-crit-1" style="text-align: right; font-family: monospace;">---</td>
                            </tr>
                            <tr>
                                <td class="label" style="padding: 0.25rem 0;">Valor Crítico (5%)</td>
                                <td class="value" id="val-adf-crit-5" style="text-align: right; font-family: monospace;">---</td>
                                <td class="value" id="val-kpss-crit-5" style="text-align: right; font-family: monospace;">---</td>
                            </tr>
                            <tr>
                                <td class="label" style="padding: 0.25rem 0;">Valor Crítico (10%)</td>
                                <td class="value" id="val-adf-crit-10" style="text-align: right; font-family: monospace;">---</td>
                                <td class="value" id="val-kpss-crit-10" style="text-align: right; font-family: monospace;">---</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;

            const badg = document.getElementById('adf-badge');
            const concl = document.getElementById('adf-conclusion');
            const vStat = document.getElementById('val-adf-stat');
            const vP = document.getElementById('val-adf-p');
            const vC1 = document.getElementById('val-adf-crit-1');
            const vC5 = document.getElementById('val-adf-crit-5');
            const vC10 = document.getElementById('val-adf-crit-10');

            const adfRes = await fetch(API_ENDPOINTS.econometrics(portfolioId, start, end));
            const adfData = await adfRes.json();
            const adfError = adfData.error || (!adfRes.ok ? adfData.message : null);

            if (adfError) {
                badg.textContent = "INSUFICIENTE";
                badg.className = "badge badge-danger";
                concl.textContent = adfError;
            } else {
                const isStationary = adfData.trend_type === "Determinista";
                const isMatch = adfData.has_unit_root !== adfData.kpss_is_stationary;
                
                let badgeText = "";
                let badgeClass = "badge ";
                if (isMatch) {
                    badgeText = adfData.trend_type;
                    badgeClass += isStationary ? "badge-success" : "badge-danger";
                } else {
                    badgeText = "MIXTA";
                    badgeClass += "badge-warning";
                }
                badg.textContent = badgeText;
                badg.className = badgeClass;

                concl.textContent = adfData.conclusion;
                vStat.textContent = adfData.adf_statistic.toFixed(5);
                vP.textContent = adfData.p_value.toFixed(5);
                vC1.textContent = adfData.critical_values["1%"].toFixed(5);
                vC5.textContent = adfData.critical_values["5%"].toFixed(5);
                vC10.textContent = adfData.critical_values["10%"].toFixed(5);
                
                document.getElementById('val-kpss-stat').textContent = adfData.kpss_statistic.toFixed(5);
                document.getElementById('val-kpss-p').textContent = adfData.kpss_p_value.toFixed(5);
                document.getElementById('val-kpss-crit-1').textContent = adfData.kpss_critical_values["1%"].toFixed(5);
                document.getElementById('val-kpss-crit-5').textContent = adfData.kpss_critical_values["5%"].toFixed(5);
                document.getElementById('val-kpss-crit-10').textContent = adfData.kpss_critical_values["10%"].toFixed(5);
            }

            const cointRes = await fetch(API_ENDPOINTS.cointegration(start, end));
            const cointData = await cointRes.json();
            const cointError = cointData.error || (!cointRes.ok ? cointData.message : null);

            if (cointError) {
                cointBadge.textContent = "ERROR";
                cointBadge.className = "badge badge-danger";
                cointConclusion.textContent = cointError;
                valCointStat.textContent = "---";
                valCointP.textContent = "---";
                valCointStatus.textContent = "---";
            } else {
                cointBadge.textContent = cointData.is_cointegrated ? "COINTEGRADOS" : "SIN COINTEGRACIÓN";
                cointBadge.className = cointData.is_cointegrated ? "badge badge-success" : "badge badge-warning";
                cointConclusion.textContent = cointData.conclusion;
                valCointStat.textContent = cointData.coint_statistic.toFixed(5);
                valCointP.textContent = cointData.p_value.toFixed(5);
                valCointStatus.textContent = cointData.is_cointegrated ? "Estable (Co-movimiento)" : "Libre (Sin equilibrio)";
            }

        } catch (e) {
            console.error(e);
        }
    }

    async function fetchComparativeEconometrics(start, end) {
        try {
            adfCardContainer.innerHTML = `
                <div class="econometric-card-header">
                    <h2>Análisis de Tendencia (ADF + KPSS) - P1 vs P2</h2>
                </div>
                
                <div style="display:flex; flex-direction:column; gap:0.5rem; height:100%; overflow-y:auto; padding-right:0.25rem;">
                    <!-- Bloque Portafolio 1 -->
                    <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:6px; padding:0.5rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                            <span style="font-size:0.75rem; font-weight:600; color:#00f3ff;">Portafolio 1</span>
                            <span class="badge" id="adf-badge-p1">---</span>
                        </div>
                        <p style="font-size:0.7rem; line-height:1.3; margin-bottom:0.35rem;" id="adf-concl-p1">Calculando...</p>
                        <div class="econometric-table-wrapper" style="padding:0.4rem; font-size:0.72rem; margin-top:0;">
                            <table class="econometric-table" style="font-size:0.72rem; width:100%;">
                                <tr>
                                    <td style="padding: 0.15rem 0;">ADF Stat / p-valor</td>
                                    <td class="value" id="val-adf-p1-stat" style="text-align: right; font-family: monospace;">---</td>
                                </tr>
                                <tr>
                                    <td style="padding: 0.15rem 0;">KPSS Stat / p-valor</td>
                                    <td class="value" id="val-kpss-p1-stat" style="text-align: right; font-family: monospace;">---</td>
                                </tr>
                            </table>
                        </div>
                    </div>

                    <!-- Bloque Portafolio 2 -->
                    <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:6px; padding:0.5rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                            <span style="font-size:0.75rem; font-weight:600; color:#cc00ff;">Portafolio 2</span>
                            <span class="badge" id="adf-badge-p2">---</span>
                        </div>
                        <p style="font-size:0.7rem; line-height:1.3; margin-bottom:0.35rem;" id="adf-concl-p2">Calculando...</p>
                        <div class="econometric-table-wrapper" style="padding:0.4rem; font-size:0.72rem; margin-top:0;">
                            <table class="econometric-table" style="font-size:0.72rem; width:100%;">
                                <tr>
                                    <td style="padding: 0.15rem 0;">ADF Stat / p-valor</td>
                                    <td class="value" id="val-adf-p2-stat" style="text-align: right; font-family: monospace;">---</td>
                                </tr>
                                <tr>
                                    <td style="padding: 0.15rem 0;">KPSS Stat / p-valor</td>
                                    <td class="value" id="val-kpss-p2-stat" style="text-align: right; font-family: monospace;">---</td>
                                </tr>
                            </table>
                        </div>
                    </div>
                </div>
            `;

            const [res1, res2, resCoint] = await Promise.all([
                fetch(API_ENDPOINTS.econometrics(1, start, end)),
                fetch(API_ENDPOINTS.econometrics(2, start, end)),
                fetch(API_ENDPOINTS.cointegration(start, end))
            ]);

            const adfP1 = await res1.json();
            const adfP2 = await res2.json();
            const cointData = await resCoint.json();

            const adfP1Error = adfP1.error || (!res1.ok ? adfP1.message : null);
            const adfP2Error = adfP2.error || (!res2.ok ? adfP2.message : null);
            const cointError = cointData.error || (!resCoint.ok ? cointData.message : null);

            const b1 = document.getElementById('adf-badge-p1');
            const c1 = document.getElementById('adf-concl-p1');
            const s1 = document.getElementById('val-adf-p1-stat');
            if (adfP1Error) {
                b1.textContent = "ERROR"; b1.className = "badge badge-danger"; c1.textContent = adfP1Error;
            } else {
                const isP1Match = adfP1.has_unit_root !== adfP1.kpss_is_stationary;
                if (isP1Match) {
                    b1.textContent = adfP1.trend_type;
                    b1.className = adfP1.trend_type === "Determinista" ? "badge badge-success" : "badge badge-danger";
                } else {
                    b1.textContent = "MIXTA";
                    b1.className = "badge badge-warning";
                }
                c1.textContent = adfP1.conclusion;
                s1.textContent = `${adfP1.adf_statistic.toFixed(3)} / ${adfP1.p_value.toFixed(3)}`;
                document.getElementById('val-kpss-p1-stat').textContent = `${adfP1.kpss_statistic.toFixed(3)} / ${adfP1.kpss_p_value.toFixed(3)}`;
            }

            const b2 = document.getElementById('adf-badge-p2');
            const c2 = document.getElementById('adf-concl-p2');
            const s2 = document.getElementById('val-adf-p2-stat');
            if (adfP2Error) {
                b2.textContent = "ERROR"; b2.className = "badge badge-danger"; c2.textContent = adfP2Error;
            } else {
                const isP2Match = adfP2.has_unit_root !== adfP2.kpss_is_stationary;
                if (isP2Match) {
                    b2.textContent = adfP2.trend_type;
                    b2.className = adfP2.trend_type === "Determinista" ? "badge badge-success" : "badge badge-danger";
                } else {
                    b2.textContent = "MIXTA";
                    b2.className = "badge badge-warning";
                }
                c2.textContent = adfP2.conclusion;
                s2.textContent = `${adfP2.adf_statistic.toFixed(3)} / ${adfP2.p_value.toFixed(3)}`;
                document.getElementById('val-kpss-p2-stat').textContent = `${adfP2.kpss_statistic.toFixed(3)} / ${adfP2.kpss_p_value.toFixed(3)}`;
            }

            if (cointError) {
                cointBadge.textContent = "ERROR";
                cointBadge.className = "badge badge-danger";
                cointConclusion.textContent = cointError;
                valCointStat.textContent = "---";
                valCointP.textContent = "---";
                valCointStatus.textContent = "---";
            } else {
                cointBadge.textContent = cointData.is_cointegrated ? "COINTEGRADOS" : "SIN COINTEGRACIÓN";
                cointBadge.className = cointData.is_cointegrated ? "badge badge-success" : "badge badge-warning";
                cointConclusion.textContent = cointData.conclusion;
                valCointStat.textContent = cointData.coint_statistic.toFixed(5);
                valCointP.textContent = cointData.p_value.toFixed(5);
                valCointStatus.textContent = cointData.is_cointegrated ? "Estable (Co-movimiento)" : "Libre (Sin equilibrio)";
            }

        } catch (e) {
            console.error(e);
        }
    }

    function renderValueChart(data) {
        if (valueChart) {
            try { valueChart.destroy(); } catch(e){}
            valueChart = null;
        }
        const categories = data.map(item => item.fecha);
        const seriesData = data.map(item => parseFloat(item.valor_total));

        const series = [{
            name: 'Valor Total (USD)',
            data: seriesData
        }];

        if (showSmaCheck.checked) {
            const smaData = [];
            for (let i = 0; i < seriesData.length; i++) {
                const startIdx = Math.max(0, i - 19);
                let sum = 0;
                let count = 0;
                for (let j = startIdx; j <= i; j++) {
                    sum += seriesData[j];
                    count++;
                }
                smaData.push(parseFloat((sum / count).toFixed(2)));
            }
            series.push({
                name: 'Tendencia SMA 20',
                data: smaData
            });
        }

        const options = getValueChartOptions('valueChartSingle', 'portfolioGroupSingle', series, ['#10b981', '#3b82f6'], categories);

        if (showMinCheck.checked && minValuationSingle) {
            const parts = minValuationSingle.date.split('-');
            const minDateFormatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
            const minValueNumber = parseFloat(minValuationSingle.value);
            options.annotations = {
                points: [
                    {
                        x: new Date(minValuationSingle.date + 'T00:00:00').getTime(),
                        y: minValueNumber,
                        marker: {
                            size: 6,
                            fillColor: '#ef4444',
                            strokeColor: '#fff',
                            radius: 2
                        },
                        label: {
                            borderColor: '#ef4444',
                            offsetY: 0,
                            style: {
                                color: '#fff',
                                background: '#ef4444'
                            },
                            text: `Mínimo: $${(minValueNumber/1e6).toFixed(1)}M (${minDateFormatted})`
                        }
                    }
                ]
            };
        }

        const chartEl = document.querySelector("#value-chart");
        chartEl.innerHTML = '';
        valueChart = new ApexCharts(chartEl, options);
        valueChart.render();
    }

    function renderOverlaidValueChart(p1, p2) {
        if (valueChart) {
            try { valueChart.destroy(); } catch(e){}
            valueChart = null;
        }
        const categories = p1.map(item => item.fecha);
        const seriesData1 = p1.map(item => parseFloat(item.valor_total));
        const seriesData2 = p2.map(item => parseFloat(item.valor_total));

        const series = [
            { name: 'Portafolio 1', data: seriesData1 },
            { name: 'Portafolio 2', data: seriesData2 }
        ];

        if (showSmaCheck.checked) {
            const smaData1 = [], smaData2 = [];
            for (let i = 0; i < seriesData1.length; i++) {
                const sIdx = Math.max(0, i - 19);
                let sum1 = 0, sum2 = 0, count = 0;
                for (let j = sIdx; j <= i; j++) {
                    sum1 += seriesData1[j];
                    sum2 += seriesData2[j];
                    count++;
                }
                smaData1.push(parseFloat((sum1 / count).toFixed(2)));
                smaData2.push(parseFloat((sum2 / count).toFixed(2)));
            }
            series.push({ name: 'Tendencia P1 (SMA 20)', data: smaData1 });
            series.push({ name: 'Tendencia P2 (SMA 20)', data: smaData2 });
        }

        const colors = showSmaCheck.checked ? ['#00f3ff', '#cc00ff', '#00f3ffaa', '#cc00ffaa'] : ['#00f3ff', '#cc00ff'];
        const options = getValueChartOptions('valueChartCompare', 'portfolioGroupCompare', series, colors, categories);

        if (showMinCheck.checked && minValuationP1 && minValuationP2) {
            const parts1 = minValuationP1.date.split('-');
            const minDateFormatted1 = `${parts1[2]}/${parts1[1]}/${parts1[0]}`;
            const minValueNumber1 = parseFloat(minValuationP1.value);

            const parts2 = minValuationP2.date.split('-');
            const minDateFormatted2 = `${parts2[2]}/${parts2[1]}/${parts2[0]}`;
            const minValueNumber2 = parseFloat(minValuationP2.value);

            options.annotations = {
                points: [
                    {
                        x: new Date(minValuationP1.date + 'T00:00:00').getTime(),
                        y: minValueNumber1,
                        marker: {
                            size: 6,
                            fillColor: '#00f3ff',
                            strokeColor: '#fff',
                            radius: 2
                        },
                        label: {
                            borderColor: '#00f3ff',
                            offsetY: 0,
                            style: {
                                color: '#030712',
                                background: '#00f3ff'
                            },
                            text: `Mín P1: $${(minValueNumber1/1e6).toFixed(1)}M (${minDateFormatted1})`
                        }
                    },
                    {
                        x: new Date(minValuationP2.date + 'T00:00:00').getTime(),
                        y: minValueNumber2,
                        marker: {
                            size: 6,
                            fillColor: '#cc00ff',
                            strokeColor: '#fff',
                            radius: 2
                        },
                        label: {
                            borderColor: '#cc00ff',
                            offsetY: 0,
                            style: {
                                color: '#fff',
                                background: '#cc00ff'
                            },
                            text: `Mín P2: $${(minValueNumber2/1e6).toFixed(1)}M (${minDateFormatted2})`
                        }
                    }
                ]
            };
        }

        const chartEl = document.querySelector("#value-chart");
        chartEl.innerHTML = '';
        valueChart = new ApexCharts(chartEl, options);
        valueChart.render();
    }

    function renderWeightsChart(data) {
        if (weightsChart) {
            try { weightsChart.destroy(); } catch(e){}
            weightsChart = null;
        }
        const categories = data.map(item => item.fecha);
        const series = getWeightsSeries(data, groupAssetsCheck.checked);
        const options = getWeightsChartOptions('weightsChartSingle', 'portfolioGroupSingle', series, categories, true);

        const chartEl = document.querySelector("#weights-chart");
        chartEl.innerHTML = '';
        weightsChart = new ApexCharts(chartEl, options);
        weightsChart.render();
    }

    function updateDiffCard(dataPointIndex) {
        const card = document.getElementById('comparison-diff-card');
        if (!card) return;
        const isCompare = (portfolioSelect.value === 'compare');
        if (!isCompare || !differenceData || differenceData.length === 0) {
            card.style.display = 'none';
            return;
        }
        card.style.display = 'flex';

        let idx = dataPointIndex;
        if (idx === null || idx === undefined || idx < 0 || idx >= differenceData.length) {
            idx = differenceData.length - 1;
        }
        const point = differenceData[idx];
        if (!point) return;

        const parts = point.fecha.split('-');
        document.getElementById('diff-card-date').textContent = `${parts[2]}/${parts[1]}/${parts[0]}`;

        document.getElementById('diff-p1-value').textContent =
            '$' + Number(point.valor_p1).toLocaleString('en-US', { minimumFractionDigits: 0 });

        document.getElementById('diff-p2-value').textContent =
            '$' + Number(point.valor_p2).toLocaleString('en-US', { minimumFractionDigits: 0 });

        const diffEl = document.getElementById('diff-abs-value');
        const sign = point.valor_p1 >= point.valor_p2 ? '+' : '\u2212';
        diffEl.textContent = sign + '$' + Math.abs(point.diferencia).toLocaleString('en-US', { minimumFractionDigits: 0 });
        diffEl.style.color = point.valor_p1 >= point.valor_p2 ? '#10b981' : '#ef4444';

        const pctEl = document.getElementById('diff-pct-value');
        const pctVal = point.diferencia_pct;
        pctEl.textContent = (pctVal >= 0 ? '+' : '') + pctVal.toFixed(2) + '%';
        pctEl.style.color = pctVal >= 0 ? '#10b981' : '#ef4444';
    }

    function drawDiffLine(dataPointIndex, w) {
        if (dataPointIndex === null || dataPointIndex === undefined || dataPointIndex < 0) {
            hideDiffLine();
            return;
        }

        const isCompare = (portfolioSelect.value === 'compare');
        if (!isCompare) {
            hideDiffLine();
            return;
        }

        const svgInner = document.querySelector("#value-chart .apexcharts-inner");
        if (!svgInner) return;

        const seriesX = w.globals.seriesX;
        const seriesY = w.globals.series;
        
        if (!seriesX || !seriesY || seriesX.length < 2 || seriesY.length < 2) {
            hideDiffLine();
            return;
        }

        const xVal = seriesX[0][dataPointIndex];
        const yVal1 = seriesY[0][dataPointIndex];
        const yVal2 = seriesY[1][dataPointIndex];

        if (xVal === undefined || yVal1 === undefined || yVal2 === undefined || yVal1 === null || yVal2 === null) {
            hideDiffLine();
            return;
        }

        const minX = w.globals.minX;
        const maxX = w.globals.maxX;
        const minY = Array.isArray(w.globals.minY) ? w.globals.minY[0] : w.globals.minY;
        const maxY = Array.isArray(w.globals.maxY) ? w.globals.maxY[0] : w.globals.maxY;

        if (maxX === minX || maxY === minY) return;

        const gridWidth = w.globals.gridWidth;
        const gridHeight = w.globals.gridHeight;

        const xPct = (xVal - minX) / (maxX - minX);
        const yPct1 = (yVal1 - minY) / (maxY - minY);
        const yPct2 = (yVal2 - minY) / (maxY - minY);

        const xPx = xPct * gridWidth;
        const yPx1 = (1 - yPct1) * gridHeight;
        const yPx2 = (1 - yPct2) * gridHeight;

        let diffLine = svgInner.querySelector('#portfolio-diff-line');
        if (!diffLine) {
            diffLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
            diffLine.setAttribute('id', 'portfolio-diff-line');
            diffLine.setAttribute('stroke', '#ef4444');
            diffLine.setAttribute('stroke-width', '2');
            diffLine.setAttribute('stroke-linecap', 'round');
            diffLine.setAttribute('stroke-dasharray', '4,3');
            diffLine.setAttribute('style', 'filter: drop-shadow(0px 0px 3px rgba(239, 68, 68, 0.6)); pointer-events: none;');
            svgInner.appendChild(diffLine);
        }
        diffLine.setAttribute('x1', xPx);
        diffLine.setAttribute('y1', yPx1);
        diffLine.setAttribute('x2', xPx);
        diffLine.setAttribute('y2', yPx2);
        diffLine.style.display = 'block';

        let dot1 = svgInner.querySelector('#portfolio-diff-dot1');
        if (!dot1) {
            dot1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            dot1.setAttribute('id', 'portfolio-diff-dot1');
            dot1.setAttribute('r', '4');
            dot1.setAttribute('fill', '#ef4444');
            dot1.setAttribute('style', 'filter: drop-shadow(0px 0px 4px rgba(239, 68, 68, 0.8)); pointer-events: none;');
            svgInner.appendChild(dot1);
        }
        dot1.setAttribute('cx', xPx);
        dot1.setAttribute('cy', yPx1);
        dot1.style.display = 'block';

        let dot2 = svgInner.querySelector('#portfolio-diff-dot2');
        if (!dot2) {
            dot2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            dot2.setAttribute('id', 'portfolio-diff-dot2');
            dot2.setAttribute('r', '4');
            dot2.setAttribute('fill', '#ef4444');
            dot2.setAttribute('style', 'filter: drop-shadow(0px 0px 4px rgba(239, 68, 68, 0.8)); pointer-events: none;');
            svgInner.appendChild(dot2);
        }
        dot2.setAttribute('cx', xPx);
        dot2.setAttribute('cy', yPx2);
        dot2.style.display = 'block';
    }

    function hideDiffLine() {
        const svgInner = document.querySelector("#value-chart .apexcharts-inner");
        if (!svgInner) return;
        const diffLine = svgInner.querySelector('#portfolio-diff-line');
        if (diffLine) diffLine.style.display = 'none';
        const dot1 = svgInner.querySelector('#portfolio-diff-dot1');
        if (dot1) dot1.style.display = 'none';
        const dot2 = svgInner.querySelector('#portfolio-diff-dot2');
        if (dot2) dot2.style.display = 'none';
    }




})();
