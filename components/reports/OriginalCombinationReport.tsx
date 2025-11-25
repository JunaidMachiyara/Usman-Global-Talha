
import React, { useState, useMemo } from 'react';
import { useData } from '../../context/DataContext.tsx';
import ReportToolbar from './ReportToolbar.tsx';
import { OriginalPurchased, PackingType, Currency, Production, Item, OriginalOpening } from '../../types.ts';
import Modal from '../ui/Modal.tsx';

// ... ModalDrilldownItem interface ...
interface ModalDrilldownItem {
    id: string;
    name: string;
    quantity: number;
    totalKg: number;
    avgPricePerKg: number;
    totalWorth: number;
    percentage: number;
}

const OriginalCombinationReport: React.FC = () => {
    const { state } = useData();

    // ... filters and state ...
    const [filters, setFilters] = useState({
        startDate: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        priceType: 'production' as 'production' | 'sales',
    });
    const [workingCostRate, setWorkingCostRate] = useState(0.20);
    const [modalData, setModalData] = useState<{ type: 'Category' | 'Section'; name: string; items: ModalDrilldownItem[] } | null>(null);

    const workingCostRates = [0.15, 0.16, 0.17, 0.18, 0.19, 0.20, 0.21, 0.22, 0.23];

    const handleFilterChange = (filterName: string, value: any) => {
        setFilters(prev => ({ ...prev, [filterName]: value }));
    };

    // Filter out negative productions (Bales Opening / Consumption)
    const productionsInPeriod = useMemo(() => 
        state.productions.filter(p => p.date >= filters.startDate && p.date <= filters.endDate && p.quantityProduced > 0), 
    [filters.startDate, filters.endDate, state.productions]);

    const {
        openedOriginals,
        totalOpenedKg,
        totalOpenedWorth,
        producedItemsByCategory,
        producedItemsBySection,
        totalProducedKg,
        totalProducedPWorth,
        totalProducedSWorth,
        costOfOriginalUsed,
        workingCost,
        garbageCost,
        difference,
        totalCost,
        productionProfitLoss,
        salesProfitLoss,
    } = useMemo(() => {
        const convertToUSD = (amount: number, currency: Currency, conversionRate: number) => {
            if (currency === Currency.Dollar) return amount;
            return amount * conversionRate;
        };

        // --- 0. Pre-calculate Global Averages for Fallback ---
        // This handles cases where Openings are dated before Purchases (negative inventory scenarios)
        const globalAvgRates: Record<string, number> = {};
        const globalTotals: Record<string, { qty: number, cost: number }> = {};

        state.originalPurchases.forEach(p => {
             const originalType = state.originalTypes.find(ot => ot.id === p.originalTypeId);
             if (!originalType) return;
             
             const qty = originalType.packingType === PackingType.Kg 
                    ? p.quantityPurchased 
                    : p.quantityPurchased * originalType.packingSize;
             
             const itemValueUSD = convertToUSD(p.quantityPurchased * p.rate, p.currency, p.conversionRate || 1);
             const freightUSD = convertToUSD(p.freightAmount || 0, p.freightCurrency || Currency.Dollar, p.freightConversionRate || 1);
             const clearingUSD = convertToUSD(p.clearingAmount || 0, p.clearingCurrency || Currency.Dollar, p.clearingConversionRate || 1);
             const commissionUSD = convertToUSD(p.commissionAmount || 0, p.commissionCurrency || Currency.Dollar, p.commissionConversionRate || 1);
             const discountSurchargeUSD = p.discountSurcharge || 0;

             const totalCostUSD = itemValueUSD + freightUSD + clearingUSD + commissionUSD + discountSurchargeUSD;

             if (!globalTotals[p.originalTypeId]) globalTotals[p.originalTypeId] = { qty: 0, cost: 0 };
             globalTotals[p.originalTypeId].qty += qty;
             globalTotals[p.originalTypeId].cost += totalCostUSD;
        });

        for(const id in globalTotals) {
            if (globalTotals[id].qty > 0) {
                globalAvgRates[id] = globalTotals[id].cost / globalTotals[id].qty;
            }
        }
        
        // --- 1. Moving Weighted Average Cost Calculation (Chronological) ---
        const timeline = [
            ...state.originalPurchases.map(p => ({ type: 'PURCHASE', date: p.date, data: p })),
            ...state.originalOpenings.map(o => ({ type: 'OPENING', date: o.date, data: o }))
        ].sort((a, b) => {
            const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
            if (dateDiff !== 0) return dateDiff;
            return a.type === 'PURCHASE' ? -1 : 1;
        });

        const inventoryState: Record<string, { currentQty: number; currentValue: number }> = {};
        const openingTransactionCosts: Record<string, number> = {}; 
        const currentAvgRates: Record<string, number> = {};

        timeline.forEach(event => {
            if (event.type === 'PURCHASE') {
                const p = event.data as OriginalPurchased;
                const originalType = state.originalTypes.find(ot => ot.id === p.originalTypeId);
                if (!originalType) return;

                const qty = originalType.packingType === PackingType.Kg 
                    ? p.quantityPurchased 
                    : p.quantityPurchased * originalType.packingSize;

                const itemValueUSD = convertToUSD(p.quantityPurchased * p.rate, p.currency, p.conversionRate || 1);
                const freightUSD = convertToUSD(p.freightAmount || 0, p.freightCurrency || Currency.Dollar, p.freightConversionRate || 1);
                const clearingUSD = convertToUSD(p.clearingAmount || 0, p.clearingCurrency || Currency.Dollar, p.clearingConversionRate || 1);
                const commissionUSD = convertToUSD(p.commissionAmount || 0, p.commissionCurrency || Currency.Dollar, p.commissionConversionRate || 1);
                const discountSurchargeUSD = p.discountSurcharge || 0;

                const totalCostUSD = itemValueUSD + freightUSD + clearingUSD + commissionUSD + discountSurchargeUSD;

                if (!inventoryState[p.originalTypeId]) {
                    inventoryState[p.originalTypeId] = { currentQty: 0, currentValue: 0 };
                }

                inventoryState[p.originalTypeId].currentQty += qty;
                inventoryState[p.originalTypeId].currentValue += totalCostUSD;

            } else {
                const o = event.data as OriginalOpening;
                if (!inventoryState[o.originalTypeId]) {
                    inventoryState[o.originalTypeId] = { currentQty: 0, currentValue: 0 };
                }

                const stateItem = inventoryState[o.originalTypeId];
                
                // Calculate cost for this opening
                let currentRate = 0;
                
                // Special handling for internal stock (Bales Opening)
                if (o.supplierId === 'SUP-INTERNAL-STOCK' && o.originalTypeId.startsWith('OT-FROM-')) {
                    const itemId = o.originalTypeId.replace('OT-FROM-', '');
                    const item = state.items.find(i => i.id === itemId);
                    if (item) currentRate = item.avgProductionPrice;
                } else if (stateItem.currentQty > 0) {
                    // Normal case: Use current moving average
                    currentRate = stateItem.currentValue / stateItem.currentQty;
                } else {
                    // Negative stock fallback: Use last known rate -> global avg rate -> 0
                    currentRate = currentAvgRates[o.originalTypeId] || globalAvgRates[o.originalTypeId] || 0; 
                }
                
                if (currentRate > 0) {
                    currentAvgRates[o.originalTypeId] = currentRate;
                }

                const costOfThisOpening = o.totalKg * currentRate;
                openingTransactionCosts[o.id] = costOfThisOpening;

                // Deduct from pool
                stateItem.currentQty -= o.totalKg;
                stateItem.currentValue -= costOfThisOpening;
                
                if (stateItem.currentQty <= 0.001) {
                    stateItem.currentQty = 0;
                    stateItem.currentValue = 0;
                }
            }
        });


        // --- 2. Calculate Report Data using the Time-Based Costs ---
        const openingsInPeriod = state.originalOpenings.filter(o => o.date >= filters.startDate && o.date <= filters.endDate);
        const totalOpenedKg = openingsInPeriod.reduce((sum, o) => sum + o.totalKg, 0);

        const openedOriginalsAggregated: { [key: string]: { name: string; totalKg: number; totalWorth: number; } } = {};
        
        openingsInPeriod.forEach(opening => {
             const originalType = state.originalTypes.find(ot => ot.id === opening.originalTypeId);
            if (originalType) {
                if (!openedOriginalsAggregated[originalType.id]) {
                    openedOriginalsAggregated[originalType.id] = { name: originalType.name, totalKg: 0, totalWorth: 0 };
                }
                
                // Use the precise historical cost calculated above
                const worth = openingTransactionCosts[opening.id] || 0;

                openedOriginalsAggregated[originalType.id].totalKg += opening.totalKg;
                openedOriginalsAggregated[originalType.id].totalWorth += worth;
            }
        });

        const openedOriginals = Object.values(openedOriginalsAggregated).map(agg => ({
            ...agg,
            percentage: totalOpenedKg > 0 ? (agg.totalKg / totalOpenedKg) * 100 : 0,
            avgPricePerKg: agg.totalKg > 0 ? agg.totalWorth / agg.totalKg : 0, 
        }));
        
        const totalOpenedWorth = openedOriginals.reduce((sum, o) => sum + o.totalWorth, 0);


        // --- 3. Finished Goods Produced ---
        const producedByCategoryAgg: { [key: string]: { name: string; totalKg: number; totalPWorth: number; totalSWorth: number } } = {};
        const producedBySectionAgg: { [key: string]: { name: string; totalKg: number; totalPWorth: number; totalSWorth: number } } = {};
        let totalProducedKg = 0;

        productionsInPeriod.forEach(prod => {
            const item = state.items.find(i => i.id === prod.itemId);
            if (item) {
                const producedKg = prod.quantityProduced * (item.packingType !== PackingType.Kg ? item.baleSize : 1);
                totalProducedKg += producedKg;

                const productionWorth = prod.quantityProduced * item.avgProductionPrice;
                const salesWorth = prod.quantityProduced * item.avgSalesPrice;

                // By Category
                const category = state.categories.find(c => c.id === item.categoryId);
                const categoryName = category ? category.name : 'Uncategorized';
                if (!producedByCategoryAgg[categoryName]) producedByCategoryAgg[categoryName] = { name: categoryName, totalKg: 0, totalPWorth: 0, totalSWorth: 0 };
                producedByCategoryAgg[categoryName].totalKg += producedKg;
                producedByCategoryAgg[categoryName].totalPWorth += productionWorth;
                producedByCategoryAgg[categoryName].totalSWorth += salesWorth;
                
                // By Section
                const section = state.sections.find(s => s.id === item.sectionId);
                const sectionKey = section ? section.name : 'Uncategorized';
                if (!producedBySectionAgg[sectionKey]) producedBySectionAgg[sectionKey] = { name: sectionKey, totalKg: 0, totalPWorth: 0, totalSWorth: 0 };
                producedBySectionAgg[sectionKey].totalKg += producedKg;
                producedBySectionAgg[sectionKey].totalPWorth += productionWorth;
                producedBySectionAgg[sectionKey].totalSWorth += salesWorth;
            }
        });
        
        const producedItemsByCategory = Object.values(producedByCategoryAgg).map(agg => ({
            name: agg.name,
            totalKg: agg.totalKg,
            percentage: totalProducedKg > 0 ? (agg.totalKg / totalProducedKg) * 100 : 0,
            avgPPricePerKg: agg.totalKg > 0 ? agg.totalPWorth / agg.totalKg : 0,
            totalPWorth: agg.totalPWorth,
            avgSPricePerKg: agg.totalKg > 0 ? agg.totalSWorth / agg.totalKg : 0,
            totalSWorth: agg.totalSWorth,
        })).sort((a,b) => b.totalKg - a.totalKg);

        const producedItemsBySection = Object.values(producedBySectionAgg).map(agg => ({
            name: agg.name,
            totalKg: agg.totalKg,
            percentage: totalProducedKg > 0 ? (agg.totalKg / totalProducedKg) * 100 : 0,
            avgPPricePerKg: agg.totalKg > 0 ? agg.totalPWorth / agg.totalKg : 0,
            totalPWorth: agg.totalPWorth,
            avgSPricePerKg: agg.totalKg > 0 ? agg.totalSWorth / agg.totalKg : 0,
            totalSWorth: agg.totalSWorth,
        })).sort((a,b) => b.totalKg - a.totalKg);
        
        const totalProducedPWorth = producedItemsByCategory.reduce((s, i) => s + i.totalPWorth, 0);
        const totalProducedSWorth = producedItemsByCategory.reduce((s, i) => s + i.totalSWorth, 0);


        // --- 4. Summary Calculations ---
        const costOfOriginalUsed = totalOpenedWorth;
        const workingCost = totalOpenedKg * workingCostRate;
        const garbageProduction = productionsInPeriod.find(p => p.itemId === 'GRBG-001');
        const garbageProducedKg = garbageProduction ? garbageProduction.quantityProduced : 0;
        const garbageCost = garbageProducedKg * 0.04;
        const difference = totalOpenedKg - totalProducedKg;
        
        const totalCost = costOfOriginalUsed + workingCost + garbageCost;
        const productionProfitLoss = totalProducedPWorth - totalCost;
        const salesProfitLoss = totalProducedSWorth - totalCost;

        return {
            openedOriginals, totalOpenedKg, totalOpenedWorth,
            producedItemsByCategory, producedItemsBySection, totalProducedKg, 
            totalProducedPWorth, totalProducedSWorth,
            costOfOriginalUsed, workingCost, garbageCost, difference,
            totalCost, productionProfitLoss, salesProfitLoss,
        };

    }, [filters, workingCostRate, state, productionsInPeriod]);

    // ... (rest of the component UI remains the same) ...
    const handleCategoryClick = (categoryName: string) => {
        const rawItems = productionsInPeriod
            .map(p => { const item = state.items.find(i => i.id === p.itemId); return { production: p, item }; })
            .filter(({ item }) => {
                if (!item) return false;
                const category = state.categories.find(c => c.id === item.categoryId);
                const itemCategoryName = category ? category.name : 'Uncategorized';
                return itemCategoryName === categoryName;
            });
    
        const totalKgForCategory = rawItems.reduce((sum, { production, item }) => {
            const totalKg = production.quantityProduced * (item!.packingType !== PackingType.Kg ? item!.baleSize : 1);
            return sum + totalKg;
        }, 0);
    
        const items: ModalDrilldownItem[] = rawItems.map(({ production, item }) => {
            const totalKg = production.quantityProduced * (item!.packingType !== PackingType.Kg ? item!.baleSize : 1);
            const priceToUse = filters.priceType === 'sales' ? item!.avgSalesPrice : item!.avgProductionPrice;
            const totalWorth = production.quantityProduced * priceToUse;
            const percentage = totalKgForCategory > 0 ? (totalKg / totalKgForCategory) * 100 : 0;
            return { id: item!.id, name: item!.name, quantity: production.quantityProduced, totalKg, avgPricePerKg: priceToUse, totalWorth, percentage };
        });
        
        setModalData({ type: 'Category', name: categoryName, items });
    };
    
    const handleSectionClick = (sectionName: string) => {
        const rawItems = productionsInPeriod
            .map(p => {
                const item = state.items.find(i => i.id === p.itemId);
                if (!item) return null;
                const section = state.sections.find(s => s.id === item.sectionId);
                return { production: p, item, sectionName: section?.name || 'Uncategorized' };
            })
            .filter((data): data is { production: Production; item: Item; sectionName: string } => !!data && data.sectionName === sectionName);

        const totalKgForSection = rawItems.reduce((sum, { production, item }) => {
            const totalKg = production.quantityProduced * (item.packingType !== PackingType.Kg ? item.baleSize : 1);
            return sum + totalKg;
        }, 0);

        const items: ModalDrilldownItem[] = rawItems.map(data => {
            const item = data.item;
            const production = data.production;
            const totalKg = production.quantityProduced * (item.packingType !== PackingType.Kg ? item.baleSize : 1);
            const priceToUse = filters.priceType === 'sales' ? item.avgSalesPrice : item.avgProductionPrice;
            const totalWorth = production.quantityProduced * priceToUse;
            const percentage = totalKgForSection > 0 ? (totalKg / totalKgForSection) * 100 : 0;
            return { id: item.id, name: item.name, quantity: production.quantityProduced, totalKg, avgPricePerKg: priceToUse, totalWorth, percentage };
        });

        setModalData({ type: 'Section', name: sectionName, items });
    };


    const formatCurrency = (val: number) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    
    return (
        <div className="report-print-area">
            <ReportToolbar
                title="Original Combination Report"
                exportData={[]}
                exportHeaders={[]}
                exportFilename={`OriginalCombination_${filters.startDate}_to_${filters.endDate}`}
            />
            
            <div className="p-4 bg-slate-50 rounded-lg border mb-6 flex flex-wrap gap-4 items-end no-print">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                    <input type="date" value={filters.startDate} onChange={(e) => handleFilterChange('startDate', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-sm"/>
                </div>
                 <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                    <input type="date" value={filters.endDate} onChange={(e) => handleFilterChange('endDate', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-sm"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Drilldown Price Basis</label>
                    <select value={filters.priceType} onChange={(e) => handleFilterChange('priceType', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-sm">
                        <option value="production">Avg. Production Price</option>
                        <option value="sales">Avg. Sales Price</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Working Cost Rate (/kg)</label>
                    <select value={workingCostRate} onChange={(e) => setWorkingCostRate(Number(e.target.value))} className="w-full p-2 border border-slate-300 rounded-md text-sm">
                        {workingCostRates.map(rate => ( <option key={rate} value={rate}>{rate.toFixed(2)}</option>))}
                    </select>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
                {/* Left Column */}
                <div className="lg:w-1/2 flex flex-col space-y-8">
                    {/* Originals Opened */}
                    <div>
                        <h3 className="text-lg font-bold text-slate-700 mb-2">Originals Opened (Cost by Moving Avg)</h3>
                        <div className="overflow-x-auto border rounded-md">
                            <table className="w-full text-left table-auto text-sm">
                                <thead>
                                    <tr className="bg-slate-100">
                                        <th className="p-2 font-semibold text-slate-600">Original Type</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right">Total Kg</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right">Avg Price/Kg</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right">Total Worth</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right">%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {openedOriginals.map(o => (
                                        <tr key={o.name} className="border-b hover:bg-slate-50">
                                            <td className="p-2 text-slate-800">{o.name}</td>
                                            <td className="p-2 text-right text-slate-800">{o.totalKg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                            <td className="p-2 text-right text-slate-800">{formatCurrency(o.avgPricePerKg)}</td>
                                            <td className="p-2 text-right text-slate-800 font-medium">{formatCurrency(o.totalWorth)}</td>
                                            <td className="p-2 text-right text-slate-800">{o.percentage.toFixed(2)}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-100 font-bold">
                                        <td className="p-2 text-right text-slate-800">Total</td>
                                        <td className="p-2 text-right text-slate-800">{totalOpenedKg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                        <td className="p-2 text-right text-slate-800">{formatCurrency(totalOpenedWorth / (totalOpenedKg || 1))}</td>
                                        <td className="p-2 text-right text-slate-800">{formatCurrency(totalOpenedWorth)}</td>
                                        <td className="p-2 text-right text-slate-800">{totalOpenedKg > 0 ? '100.00%': '0.00%'}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* Summary Ledger */}
                    <div>
                        <h3 className="text-lg font-bold text-slate-700 mb-2">Summary</h3>
                        <div className="bg-white p-4 rounded-lg shadow-md border space-y-4 text-sm">
                            <div className="space-y-2">
                                <div className="flex justify-between"><dt className="text-slate-700">Cost of Original Used</dt><dd className="font-medium text-slate-800">{formatCurrency(costOfOriginalUsed)}</dd></div>
                                <div className="flex justify-between"><dt className="text-slate-700">Working Cost (@ ${workingCostRate.toFixed(2)}/kg)</dt><dd className="font-medium text-slate-800">{formatCurrency(workingCost)}</dd></div>
                                <div className="flex justify-between"><dt className="text-slate-700">Garbage Cost (@ $0.04/kg)</dt><dd className="font-medium text-slate-800">{formatCurrency(garbageCost)}</dd></div>
                            </div>
                            <div className="flex justify-between border-t pt-2"><dt className="font-bold text-slate-800">Total Cost</dt><dd className="font-bold text-slate-900">{formatCurrency(totalCost)}</dd></div>

                            <div className="border-t pt-2 space-y-2">
                                <div className="flex justify-between"><dt className="font-bold text-blue-700">Total Production Value</dt><dd className="font-bold text-blue-800">{formatCurrency(totalProducedPWorth)}</dd></div>
                                <div className="flex justify-between"><dt className="font-semibold text-slate-700">Profit / Loss (Production Basis)</dt><dd className={`font-bold ${productionProfitLoss >= 0 ? 'text-green-800' : 'text-red-800'}`}>{formatCurrency(productionProfitLoss)}</dd></div>
                            </div>
                            
                            <div className="border-t pt-2 space-y-2">
                                <div className="flex justify-between"><dt className="font-bold text-green-700">Total Sales Value</dt><dd className="font-bold text-green-800">{formatCurrency(totalProducedSWorth)}</dd></div>
                                <div className="flex justify-between"><dt className="font-semibold text-slate-700">Profit / Loss (Sales Basis)</dt><dd className={`font-bold ${salesProfitLoss >= 0 ? 'text-green-800' : 'text-red-800'}`}>{formatCurrency(salesProfitLoss)}</dd></div>
                            </div>
                            
                            <div className="flex justify-between border-t pt-2">
                                <dt className="text-slate-700">Difference / Unaccounted (Kg)</dt>
                                <dd className={`font-medium ${difference !== 0 ? 'text-red-700' : 'text-slate-800'}`}>{difference.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg</dd>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column */}
                <div className="lg:w-1/2 flex flex-col space-y-8">
                    {/* Production by Category */}
                    <div>
                        <h3 className="text-lg font-bold text-slate-700 mb-2">Production (by Category)</h3>
                        <div className="overflow-x-auto border rounded-md">
                            <table className="w-full text-left table-auto text-sm">
                                <thead>
                                    <tr className="bg-slate-100">
                                        <th className="p-2 font-semibold text-slate-600">Category</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right">Total Kg</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right bg-blue-50">Avg P/Price</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right bg-blue-50">Total P/Worth</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right bg-green-50">Avg S/Price</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right bg-green-50">Total S/Worth</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right">%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {producedItemsByCategory.map(p => (
                                        <tr key={p.name} className="border-b hover:bg-slate-50">
                                            <td className="p-2">
                                                <button onClick={() => handleCategoryClick(p.name)} className="text-blue-600 hover:underline">
                                                    {p.name}
                                                </button>
                                            </td>
                                            <td className="p-2 text-right text-slate-800">{p.totalKg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                            <td className="p-2 text-right text-slate-800 bg-blue-50">{formatCurrency(p.avgPPricePerKg)}</td>
                                            <td className="p-2 text-right text-slate-800 font-medium bg-blue-50">{formatCurrency(p.totalPWorth)}</td>
                                            <td className="p-2 text-right text-slate-800 bg-green-50">{formatCurrency(p.avgSPricePerKg)}</td>
                                            <td className="p-2 text-right text-slate-800 font-medium bg-green-50">{formatCurrency(p.totalSWorth)}</td>
                                            <td className="p-2 text-right text-slate-800">{p.percentage.toFixed(2)}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-100 font-bold">
                                        <td className="p-2 text-right text-slate-800">Total</td>
                                        <td className="p-2 text-right text-slate-800">{totalProducedKg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                        <td className="p-2 text-right text-slate-800 bg-blue-50">{formatCurrency(totalProducedPWorth / (totalProducedKg || 1))}</td>
                                        <td className="p-2 text-right text-slate-800 bg-blue-50">{formatCurrency(totalProducedPWorth)}</td>
                                        <td className="p-2 text-right text-slate-800 bg-green-50">{formatCurrency(totalProducedSWorth / (totalProducedKg || 1))}</td>
                                        <td className="p-2 text-right text-slate-800 bg-green-50">{formatCurrency(totalProducedSWorth)}</td>
                                        <td className="p-2 text-right text-slate-800">{totalProducedKg > 0 ? '100.00%' : '0.00%'}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                    
                    {/* Production by Section */}
                    <div>
                        <h3 className="text-lg font-bold text-slate-700 mb-2">Production (by Section)</h3>
                        <div className="overflow-x-auto border rounded-md">
                            <table className="w-full text-left table-auto text-sm">
                                <thead>
                                    <tr className="bg-slate-100">
                                        <th className="p-2 font-semibold text-slate-600">Section</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right">Total Kg</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right bg-blue-50">Avg P/Price</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right bg-blue-50">Total P/Worth</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right bg-green-50">Avg S/Price</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right bg-green-50">Total S/Worth</th>
                                        <th className="p-2 font-semibold text-slate-600 text-right">%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {producedItemsBySection.map(p => (
                                        <tr key={p.name} className="border-b hover:bg-slate-50">
                                            <td className="p-2">
                                                <button onClick={() => handleSectionClick(p.name)} className="text-blue-600 hover:underline">
                                                    {p.name}
                                                </button>
                                            </td>
                                            <td className="p-2 text-right text-slate-800">{p.totalKg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                            <td className="p-2 text-right text-slate-800 bg-blue-50">{formatCurrency(p.avgPPricePerKg)}</td>
                                            <td className="p-2 text-right text-slate-800 font-medium bg-blue-50">{formatCurrency(p.totalPWorth)}</td>
                                            <td className="p-2 text-right text-slate-800 bg-green-50">{formatCurrency(p.avgSPricePerKg)}</td>
                                            <td className="p-2 text-right text-slate-800 font-medium bg-green-50">{formatCurrency(p.totalSWorth)}</td>
                                            <td className="p-2 text-right text-slate-800">{p.percentage.toFixed(2)}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-100 font-bold">
                                        <td className="p-2 text-right text-slate-800">Total</td>
                                        <td className="p-2 text-right text-slate-800">{totalProducedKg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                        <td className="p-2 text-right text-slate-800 bg-blue-50">{formatCurrency(totalProducedPWorth / (totalProducedKg || 1))}</td>
                                        <td className="p-2 text-right text-slate-800 bg-blue-50">{formatCurrency(totalProducedPWorth)}</td>
                                        <td className="p-2 text-right text-slate-800 bg-green-50">{formatCurrency(totalProducedSWorth / (totalProducedKg || 1))}</td>
                                        <td className="p-2 text-right text-slate-800 bg-green-50">{formatCurrency(totalProducedSWorth)}</td>
                                        <td className="p-2 text-right text-slate-800">{totalProducedKg > 0 ? '100.00%' : '0.00%'}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {modalData && (
                <Modal
                    isOpen={!!modalData}
                    onClose={() => setModalData(null)}
                    title={`Production Details for ${modalData.type}: ${modalData.name}`}
                >
                    <div className="overflow-x-auto">
                        <table className="w-full text-left table-auto text-sm">
                            <thead>
                                <tr className="bg-slate-100">
                                    <th className="p-2 font-semibold text-slate-600">Item Name</th>
                                    <th className="p-2 font-semibold text-slate-600 text-right">Qty</th>
                                    <th className="p-2 font-semibold text-slate-600 text-right">Total Kg</th>
                                    <th className="p-2 font-semibold text-slate-600 text-right">Avg Price</th>
                                    <th className="p-2 font-semibold text-slate-600 text-right">Total Worth</th>
                                    <th className="p-2 font-semibold text-slate-600 text-right">%</th>
                                </tr>
                            </thead>
                            <tbody>
                                {modalData.items.map(item => (
                                    <tr key={item.id} className="border-b hover:bg-slate-50">
                                        <td className="p-2 text-slate-800">{item.name} ({item.id})</td>
                                        <td className="p-2 text-right text-slate-800">{item.quantity.toLocaleString()}</td>
                                        <td className="p-2 text-right text-slate-800">{item.totalKg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                        <td className="p-2 text-right text-slate-800">{formatCurrency(item.avgPricePerKg)}</td>
                                        <td className="p-2 text-right font-medium text-slate-800">{formatCurrency(item.totalWorth)}</td>
                                        <td className="p-2 text-right text-slate-800">{item.percentage.toFixed(2)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-slate-100 font-bold">
                                    <td colSpan={2} className="p-2 text-right text-slate-800">Total</td>
                                    <td className="p-2 text-right text-slate-800">
                                        {modalData.items.reduce((sum, item) => sum + item.totalKg, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    </td>
                                    <td></td>
                                    <td className="p-2 text-right text-slate-800">
                                        {formatCurrency(modalData.items.reduce((sum, item) => sum + item.totalWorth, 0))}
                                    </td>
                                    <td className="p-2 text-right text-slate-800">100.00%</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default OriginalCombinationReport;
