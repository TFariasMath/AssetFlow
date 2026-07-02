(function() {
    "use strict";

    // 1. Centralización de Endpoints API
    const API_ENDPOINTS = {
        portfolios: () => '/api/portfolios/',
        evolution: (id, start, end) => `/api/portfolios/${id}/evolution/?fecha_inicio=${start}&fecha_fin=${end}`,
        cointegration: (start, end) => `/api/portfolios/cointegration/?fecha_inicio=${start}&fecha_fin=${end}`,
        econometrics: (id, start, end) => `/api/portfolios/${id}/econometrics/?fecha_inicio=${start}&fecha_fin=${end}`
    };

    // 2. Caché de Elementos del DOM
    const loader = document.getElementById('loader');
    const portfolioSelect = document.getElementById('portfolio-select');
    const dateStartInput = document.getElementById('date-start');
    const dateEndInput = document.getElementById('date-end');
    const btnUpdate = document.getElementById('btn-update');
    const btnCsv = document.getElementById('btn-csv');
    const btnPdf = document.getElementById('btn-pdf');
    const groupAssetsCheck = document.getElementById('group-assets');
    const showSmaCheck = document.getElementById('show-sma');

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


    let portfoliosData = [];
    let rawEvolutionData = [];
    let rawEvolutionDataP1 = [];
    let rawEvolutionDataP2 = [];

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
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
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
                    zoomed: (ctx, { xaxis }) => { if (xaxis && xaxis.min && xaxis.max) handleChartZoom(xaxis.min, xaxis.max); },
                    scrolled: (ctx, { xaxis }) => { if (xaxis && xaxis.min && xaxis.max) handleChartZoom(xaxis.min, xaxis.max); }
                }
            },
            series: series,
            colors: colors,
            stroke: {
                curve: 'smooth',
                width: series.length > 2 ? [2.5, 2.5, 1.2, 1.2] : [2.5, 1.5],
                dashArray: series.length > 2 ? [0, 0, 4, 4] : [0, 5]
            },
            fill: {
                type: 'gradient',
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: colors.length > 2 ? [0.3, 0.3, 0.02, 0.02] : [0.35, 0.05],
                    opacityTo: colors.length > 2 ? [0.02, 0.02, 0.01, 0.01] : [0.02, 0.01],
                    stops: [0, 95]
                }
            },
            xaxis: { categories: categories, type: 'datetime', labels: { format: 'dd/MM/yy' } },
            yaxis: { labels: { formatter: val => '$' + (val / 1e6).toFixed(1) + 'M' } },
            tooltip: {
                ...base.tooltip,
                y: { formatter: val => '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2 }) }
            }
        };
    }

    // Constructor de opciones para gráficos de pesos
    function getWeightsChartOptions(chartId, groupId, series, categories, showLegend = false) {
        const base = getBaseChartOptions(chartId, groupId);
        return {
            ...base,
            chart: {
                ...base.chart,
                type: 'area',
                stacked: true,
                toolbar: { show: false }
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
            tooltip: {
                ...base.tooltip,
                y: { formatter: val => val.toFixed(2) + '%' }
            },
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
                calculateComparativeKPIs(filteredP1, filteredP2);
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
    });

    btnUpdate.addEventListener('click', async () => {
        showLoader();
        await loadChartAndEconometricData();
        hideLoader();
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

    groupAssetsCheck.addEventListener('change', () => {
        const isCompare = (portfolioSelect.value === 'compare');
        if (isCompare) {
            if (rawEvolutionDataP1.length > 0 && rawEvolutionDataP2.length > 0) {
                updateCompareWeightsSelector();
            }
        } else {
            if (rawEvolutionData.length > 0) renderWeightsChart(rawEvolutionData);
        }
    });

    btnCsv.addEventListener('click', () => {
        const isCompare = (portfolioSelect.value === 'compare');
        if (isCompare) {
            if (rawEvolutionDataP1.length === 0 || rawEvolutionDataP2.length === 0) return;
            exportComparativeCSV(rawEvolutionDataP1, rawEvolutionDataP2);
        } else {
            if (rawEvolutionData.length === 0) return;
            exportToCSV(rawEvolutionData);
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

    function renderSharedLegend(series, colors) {
        const legendEl = document.getElementById('weights-shared-legend');
        if (!legendEl) return;
        legendEl.innerHTML = '';
        
        series.forEach((s, idx) => {
            const color = colors[idx % colors.length];
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '0.35rem';
            item.style.fontSize = '0.72rem';
            item.style.color = 'var(--text-secondary)';
            
            item.innerHTML = `
                <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:${color}; box-shadow: 0 0 6px ${color}80;"></span>
                <span>${s.name}</span>
            `;
            legendEl.appendChild(item);
        });
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

    function renderCompareWeightsChart(selectedAsset, p1, p2) {
        if (weightsChartP1) {
            try { weightsChartP1.destroy(); } catch(e){}
            weightsChartP1 = null;
        }

        const series1 = getWeightsSeries(p1, groupAssetsCheck.checked);
        const series2 = getWeightsSeries(p2, groupAssetsCheck.checked);

        const s1 = series1.find(s => s.name === selectedAsset);
        const s2 = series2.find(s => s.name === selectedAsset);

        const data1 = s1 ? s1.data : p1.map(() => 0);
        const data2 = s2 ? s2.data : p2.map(() => 0);

        const categories = p1.map(item => item.fecha);
        const series = [
            { name: 'Portafolio 1', data: data1 },
            { name: 'Portafolio 2', data: data2 }
        ];

        const base = getBaseChartOptions('weightsChartCompare', 'portfolioGroupCompare');
        const options = {
            ...base,
            chart: {
                ...base.chart,
                type: 'line'
            },
            colors: ['#00f3ff', '#cc00ff'],
            series: series,
            stroke: {
                curve: 'smooth',
                width: 2.5
            },
            xaxis: {
                categories: categories,
                type: 'datetime',
                labels: { format: 'dd/MM/yy' }
            },
            yaxis: {
                labels: { formatter: val => val.toFixed(1) + '%' }
            },
            tooltip: {
                ...base.tooltip,
                y: { formatter: val => val.toFixed(2) + '%' }
            }
        };

        const chartEl = document.querySelector("#weights-chart-compare");
        if (chartEl) {
            chartEl.innerHTML = '';
            weightsChartP1 = new ApexCharts(chartEl, options);
            weightsChartP1.render();
        }
    }

    function updateCompareWeightsSelector() {
        const assetSelect = document.getElementById('asset-compare-select');
        if (assetSelect) {
            const currentSelectedAsset = assetSelect.value;
            assetSelect.innerHTML = '';
            
            const series1 = getWeightsSeries(rawEvolutionDataP1, groupAssetsCheck.checked);
            const assetNames = series1.map(s => s.name);
            
            assetNames.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                assetSelect.appendChild(opt);
            });

            if (currentSelectedAsset && assetNames.includes(currentSelectedAsset)) {
                assetSelect.value = currentSelectedAsset;
            } else {
                assetSelect.value = assetNames[0] || '';
            }

            renderCompareWeightsChart(assetSelect.value, rawEvolutionDataP1, rawEvolutionDataP2);
        }
    }

    function setupWeightsChartContainers(isCompare) {
        const container = document.getElementById('weights-chart-container');
        const titleEl = document.getElementById('weights-chart-title');
        
        if (isCompare) {
            titleEl.textContent = "Comparativa de Pesos por Activo";
            if (weightsChart) {
                try { weightsChart.destroy(); } catch(e){}
                weightsChart = null;
            }
            container.classList.add('compare-mode');
            container.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; flex-shrink: 0;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600;">Ver evolución de peso para:</div>
                    <select id="asset-compare-select" style="background: rgba(17, 24, 39, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 0.25rem 0.5rem; color: var(--text-primary); font-family: inherit; font-size: 0.8rem; cursor: pointer; outline: none; transition: border-color 0.2s;"></select>
                </div>
                <div id="weights-chart-compare" style="width: 100%; height: calc(100% - 30px);"></div>
            `;
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
                const [res1, res2] = await Promise.all([
                    fetch(API_ENDPOINTS.evolution(1, start, end)),
                    fetch(API_ENDPOINTS.evolution(2, start, end))
                ]);
                const dataP1 = await res1.json();
                const dataP2 = await res2.json();
                rawEvolutionDataP1 = dataP1.series;
                rawEvolutionDataP2 = dataP2.series;

                if (rawEvolutionDataP1.length === 0 || rawEvolutionDataP2.length === 0) {
                    alert('No se encontraron registros en el rango seleccionado.');
                    return;
                }

                setupWeightsChartContainers(true);
                calculateComparativeKPIs(dataP1.kpis, dataP2.kpis, false);
                await fetchComparativeEconometrics(start, end);
                
                renderOverlaidValueChart(rawEvolutionDataP1, rawEvolutionDataP2);
                
                updateCompareWeightsSelector();
                const assetSelect = document.getElementById('asset-compare-select');
                if (assetSelect) {
                    assetSelect.addEventListener('change', () => {
                        renderCompareWeightsChart(assetSelect.value, rawEvolutionDataP1, rawEvolutionDataP2);
                    });
                }
            } catch (err) {
                console.error(err);
            }
        } else {
            try {
                const evolutionRes = await fetch(API_ENDPOINTS.evolution(selectedVal, start, end));
                const data = await evolutionRes.json();
                rawEvolutionData = data.series;

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
        const values = data.map(item => parseFloat(item.valor_total));
        const returns = [];
        for (let i = 1; i < values.length; i++) {
            returns.push((values[i] - values[i-1]) / values[i-1]);
        }
        if (returns.length < 2) return { vol: 0, sharpe: 0 };
        
        const mean = returns.reduce((acc, val) => acc + val, 0) / returns.length;
        const variance = returns.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (returns.length - 1);
        const stdev = Math.sqrt(variance);
        
        const volAnual = stdev * Math.sqrt(252) * 100;
        
        const vInit = values[0];
        const vFinal = values[values.length - 1];
        const totalReturn = (vFinal - vInit) / vInit;
        
        const rf = 0.03;
        const sharpe = (totalReturn - rf) / (stdev * Math.sqrt(252));
        
        return { vol: volAnual, sharpe: sharpe };
    }

    function calculateFinancialKPIs(kpisOrData, dataFallback = null) {
        let roi, mdd, starAsset, starAssetReturn;
        
        if (dataFallback === null) {
            // Cálculo local (ej. en zoom)
            const data = kpisOrData;
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
            <div style="font-size: 1.1rem; line-height: 1.3; font-weight: 600; color:#ef4444;">
                P1: -${maxDD1.toFixed(2)}%<br>
                P2: -${maxDD2.toFixed(2)}%
            </div>
        `;

        kpiTopTitle.innerHTML = `Volatilidad / Sharpe <span class="help-tooltip" data-tooltip="La volatilidad mide el riesgo anualizado de los retornos diarios. El Ratio de Sharpe ajusta el retorno neto del período restando la tasa libre de riesgo (3%) por unidad de volatilidad.">?</span>`;
        
        kpiTop.innerHTML = `
            <div style="font-size: 1.05rem; line-height: 1.3; font-weight: 600; color:#f59e0b;">
                P1: ${stats1.volatility.toFixed(1)}% (${stats1.sharpe >= 0 ? '+' : ''}${stats1.sharpe.toFixed(2)})<br>
                P2: ${stats2.volatility.toFixed(1)}% (${stats2.sharpe >= 0 ? '+' : ''}${stats2.sharpe.toFixed(2)})
            </div>
        `;
        kpiTopDesc.textContent = "Volatilidad anualizada (Ratio Sharpe)";
    }

    async function fetchSingleEconometrics(portfolioId, start, end) {
        try {
            adfCardContainer.innerHTML = `
                <div class="econometric-card-header">
                    <h2>Test de Raíz Unitaria (ADF)</h2>
                    <span class="badge" id="adf-badge">---</span>
                </div>
                <p id="adf-conclusion">Cargando datos de análisis de tendencia...</p>
                <div class="econometric-table-wrapper">
                    <table class="econometric-table">
                        <tr>
                            <td class="label">Estadístico del Test (ADF)</td>
                            <td class="value" id="val-adf-stat">---</td>
                        </tr>
                        <tr>
                            <td class="label">p-valor</td>
                            <td class="value" id="val-adf-p">---</td>
                        </tr>
                        <tr>
                            <td class="label">Valor Crítico (1%)</td>
                            <td class="value" id="val-adf-crit-1">---</td>
                        </tr>
                        <tr>
                            <td class="label">Valor Crítico (5%)</td>
                            <td class="value" id="val-adf-crit-5">---</td>
                        </tr>
                        <tr>
                            <td class="label">Valor Crítico (10%)</td>
                            <td class="value" id="val-adf-crit-10">---</td>
                        </tr>
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

            if (adfData.error) {
                badg.textContent = "INSUFICIENTE";
                badg.className = "badge badge-danger";
                concl.textContent = adfData.error;
            } else {
                const isStationary = adfData.trend_type === "Determinista";
                badg.textContent = adfData.trend_type;
                badg.className = isStationary ? "badge badge-success" : "badge badge-danger";
                concl.textContent = adfData.conclusion;
                vStat.textContent = adfData.adf_statistic.toFixed(5);
                vP.textContent = adfData.p_value.toFixed(5);
                vC1.textContent = adfData.critical_values["1%"].toFixed(5);
                vC5.textContent = adfData.critical_values["5%"].toFixed(5);
                vC10.textContent = adfData.critical_values["10%"].toFixed(5);
            }

            const cointRes = await fetch(API_ENDPOINTS.cointegration(start, end));
            const cointData = await cointRes.json();

            if (cointData.error) {
                cointBadge.textContent = "ERROR";
                cointBadge.className = "badge badge-danger";
                cointConclusion.textContent = cointData.error;
                valCointStat.textContent = "---";
                valCointP.textContent = "---";
                valCointStatus.textContent = "---";
            } else {
                cointBadge.textContent = cointData.is_cointegrated ? "COINTEGRADOS" : "DIVERGENTES";
                cointBadge.className = cointData.is_cointegrated ? "badge badge-success" : "badge badge-danger";
                cointConclusion.textContent = cointData.conclusion;
                valCointStat.textContent = cointData.coint_statistic.toFixed(5);
                valCointP.textContent = cointData.p_value.toFixed(5);
                valCointStatus.textContent = cointData.is_cointegrated ? "Estable (Co-movimiento)" : "Divergente (Sin equilibrio)";
            }

        } catch (e) {
            console.error(e);
        }
    }

    async function fetchComparativeEconometrics(start, end) {
        try {
            adfCardContainer.innerHTML = `
                <div class="econometric-card-header">
                    <h2>Test de Raíz Unitaria (ADF) - P1 vs P2</h2>
                </div>
                
                <div style="display:flex; flex-direction:column; gap:0.5rem; height:100%; overflow-y:auto; padding-right:0.25rem;">
                    <!-- Bloque Portafolio 1 -->
                    <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:6px; padding:0.5rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                            <span style="font-size:0.75rem; font-weight:600; color:#00f3ff;">Portafolio 1</span>
                            <span class="badge" id="adf-badge-p1">---</span>
                        </div>
                        <p style="font-size:0.75rem; line-height:1.3; margin-bottom:0.35rem;" id="adf-concl-p1">Calculando...</p>
                        <div class="econometric-table-wrapper" style="padding:0.4rem; font-size:0.75rem; margin-top:0;">
                            <table class="econometric-table" style="font-size:0.75rem;">
                                <tr>
                                    <td>Estadístico ADF / p-valor</td>
                                    <td class="value" id="val-adf-p1-stat">---</td>
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
                        <p style="font-size:0.75rem; line-height:1.3; margin-bottom:0.35rem;" id="adf-concl-p2">Calculando...</p>
                        <div class="econometric-table-wrapper" style="padding:0.4rem; font-size:0.75rem; margin-top:0;">
                            <table class="econometric-table" style="font-size:0.75rem;">
                                <tr>
                                    <td>Estadístico ADF / p-valor</td>
                                    <td class="value" id="val-adf-p2-stat">---</td>
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

            const b1 = document.getElementById('adf-badge-p1');
            const c1 = document.getElementById('adf-concl-p1');
            const s1 = document.getElementById('val-adf-p1-stat');
            if (adfP1.error) {
                b1.textContent = "ERROR"; b1.className = "badge badge-danger"; c1.textContent = adfP1.error;
            } else {
                b1.textContent = adfP1.trend_type;
                b1.className = adfP1.trend_type === "Determinista" ? "badge badge-success" : "badge badge-danger";
                c1.textContent = adfP1.conclusion;
                s1.textContent = `${adfP1.adf_statistic.toFixed(4)} / ${adfP1.p_value.toFixed(4)}`;
            }

            const b2 = document.getElementById('adf-badge-p2');
            const c2 = document.getElementById('adf-concl-p2');
            const s2 = document.getElementById('val-adf-p2-stat');
            if (adfP2.error) {
                b2.textContent = "ERROR"; b2.className = "badge badge-danger"; c2.textContent = adfP2.error;
            } else {
                b2.textContent = adfP2.trend_type;
                b2.className = adfP2.trend_type === "Determinista" ? "badge badge-success" : "badge badge-danger";
                c2.textContent = adfP2.conclusion;
                s2.textContent = `${adfP2.adf_statistic.toFixed(4)} / ${adfP2.p_value.toFixed(4)}`;
            }

            if (cointData.error) {
                cointBadge.textContent = "ERROR";
                cointBadge.className = "badge badge-danger";
                cointConclusion.textContent = cointData.error;
                valCointStat.textContent = "---";
                valCointP.textContent = "---";
                valCointStatus.textContent = "---";
            } else {
                cointBadge.textContent = cointData.is_cointegrated ? "COINTEGRADOS" : "DIVERGENTES";
                cointBadge.className = cointData.is_cointegrated ? "badge badge-success" : "badge badge-danger";
                cointConclusion.textContent = cointData.conclusion;
                valCointStat.textContent = cointData.coint_statistic.toFixed(5);
                valCointP.textContent = cointData.p_value.toFixed(5);
                valCointStatus.textContent = cointData.is_cointegrated ? "Estable (Co-movimiento)" : "Divergente (Sin equilibrio)";
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





    function exportToCSV(data) {
        const assetNames = Object.keys(data[0].pesos);
        let csvContent = "Fecha,Valor Total (USD)," + assetNames.map(n => n.replace(/,/g, '')).join(",") + "\n";
        data.forEach(item => {
            const row = [
                item.fecha,
                parseFloat(item.valor_total).toFixed(2),
                ...assetNames.map(name => (item.pesos[name] * 100).toFixed(4))
            ];
            csvContent += row.join(",") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        const portName = portfolioSelect.options[portfolioSelect.selectedIndex].text.replace(/\s+/g, '_');
        link.setAttribute("download", `${portName}_evolucion_${dateStartInput.value}_a_${dateEndInput.value}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function exportComparativeCSV(p1, p2) {
        const assetNames = Object.keys(p1[0].pesos);
        let csvContent = "Fecha,Valor Total P1 (USD),Valor Total P2 (USD)," + 
                         assetNames.map(n => `Peso P1 ${n.replace(/,/g, '')} (%)`).join(",") + "," +
                         assetNames.map(n => `Peso P2 ${n.replace(/,/g, '')} (%)`).join(",") + "\n";
        
        p1.forEach((item, idx) => {
            const item2 = p2[idx];
            const row = [
                item.fecha,
                parseFloat(item.valor_total).toFixed(2),
                parseFloat(item2.valor_total).toFixed(2),
                ...assetNames.map(name => (item.pesos[name] * 100).toFixed(4)),
                ...assetNames.map(name => (item2.pesos[name] * 100).toFixed(4))
            ];
            csvContent += row.join(",") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Comparativa_Portafolios_evolucion_${dateStartInput.value}_a_${dateEndInput.value}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
})();
