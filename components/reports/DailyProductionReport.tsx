
import React, { useState, useMemo } from 'react';
import { useData } from '../../context/DataContext.tsx';
import ReportFilters from './ReportFilters.tsx';
import ReportToolbar from './ReportToolbar.tsx';
import { PackingType, Currency, OriginalPurchased } from '../../types.ts';

const DailyProductionReport: React.FC = () => {
    const { state } = useData();
    const today = new Date().toISOString().split('T')[0];
    
    const [filters, setFilters] = useState({
        date: today,
    });

    const handleFilterChange = (filterName: string, value: any) => {
        setFilters(prev => ({ ...prev, [filterName]: value }));
    };

    // Helper to format currency
    const formatCurrency = (val: number) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

    // 1. Calculate Weighted Average Cost per Original Type to value the openings
    const avgCostPerKg = useMemo(() => {
        const costMap: { [originalTypeId: string]: { totalKg: number; totalCost: number } } = {};
        
        state.originalPurchases.forEach((p: OriginalPurchased) => {
            const originalType = state.originalTypes.find(ot => ot.id === p.originalTypeId);
            if (!originalType) return;

            const purchaseKg = originalType.packingType === PackingType.Kg 
                ? p.quantityPurchased 
                : p.quantityPurchased * originalType.packingSize;

            // Calculate Landed Cost in USD
            const itemValueUSD = (p.quantityPurchased * p.rate) * (p.conversionRate || 1);
            const freightUSD = (p.freightAmount || 0) * (p.freightConversionRate || 1);
            const clearingUSD = (p.clearingAmount || 0) * (p.clearingConversionRate || 1);
            const commissionUSD = (p.commissionAmount || 0) * (p.commissionConversionRate || 1);
            const discountSurchargeUSD = p.discountSurcharge || 0;

            const purchaseCostUSD = itemValueUSD + freightUSD + clearingUSD + commissionUSD + discountSurchargeUSD;
            
            if (!costMap[p.originalTypeId]) {
                costMap[p.originalTypeId] = { totalKg: 0, totalCost: 0 };
            }
            if (purchaseKg > 0) {
              costMap[p.originalTypeId].totalKg += purchaseKg;
              costMap[p.originalTypeId].totalCost += purchaseCostUSD;
            }
        });

        const avgs: { [typeId: string]: number } = {};
        for (const typeId in costMap) {
            if (costMap[typeId].totalKg > 0) {
                avgs[typeId] = costMap[typeId].totalCost / costMap[typeId].totalKg;
            }
        }
        return avgs;
    }, [state.originalPurchases, state.originalTypes]);

    // 2. Calculate Total Worth of Original Opened on selected date
    const totalOriginalOpenedWorth = useMemo(() => {
        return state.originalOpenings
            .filter(o => o.date === filters.date)
            .reduce((sum, o) => {
                const costPerKg = avgCostPerKg[o.originalTypeId] || 0;
                return sum + (o.totalKg * costPerKg);
            }, 0);
    }, [filters.date, state.originalOpenings, avgCostPerKg]);

    // 3. Prepare Report Data with Production Worth
    const reportData = useMemo(() => {
        return state.productions
            .filter(p => p.date === filters.date)
            .map(p => {
                const item = state.items.find(i => i.id === p.itemId);
                const packageTypesWithSize = [PackingType.Bales, PackingType.Sacks, PackingType.Box, PackingType.Bags];
                
                const isPackage = item?.packingType === PackingType.Kg ? false : (item && packageTypesWithSize.includes(item.packingType));
                const packageSize = isPackage ? (item.baleSize || 0) : 1;
                
                // Calculate Total Kg produced for this entry
                const totalKgProduced = p.quantityProduced * packageSize;
                
                // Calculate Worth: Total Kg * Avg Production Price
                const productionWorth = totalKgProduced * (item?.avgProductionPrice || 0);

                return {
                    id: p.id,
                    itemId: p.itemId,
                    itemName: item?.name || 'Unknown',
                    category: state.categories.find(c => c.id === item?.categoryId)?.name || 'N/A',
                    section: state.sections.find(s => s.id === item?.sectionId)?.name || 'N/A',
                    packingType: item?.packingType || PackingType.Kg,
                    packageSize: isPackage ? packageSize : 'N/A',
                    quantityProduced: p.quantityProduced,
                    productionWorth: productionWorth
                };
            })
            .sort((a, b) => a.itemName.localeCompare(b.itemName));
    }, [filters.date, state.productions, state.items, state.categories, state.sections]);
    
    // 4. Calculate Totals
    const { totalPackages, totalKg, totalFinishedGoodsWorth } = useMemo(() => {
        let packages = 0;
        let kg = 0;
        let worth = 0;

        reportData.forEach(row => {
            const itemDetails = state.items.find(i => i.id === row.itemId);
            if (!itemDetails) return;
    
            const isPackage = [PackingType.Bales, PackingType.Sacks, PackingType.Box, PackingType.Bags].includes(itemDetails.packingType);

            if (isPackage) {
                packages += row.quantityProduced;
                kg += row.quantityProduced * itemDetails.baleSize;
            } else { // It must be PackingType.Kg
                kg += row.quantityProduced;
            }
            
            worth += row.productionWorth;
        });
        return { totalPackages: packages, totalKg: kg, totalFinishedGoodsWorth: worth };
    }, [reportData, state.items]);

    const exportHeaders = [
        { label: 'Item ID', key: 'itemId' },
        { label: 'Item Name', key: 'itemName' },
        { label: 'Category', key: 'category' },
        { label: 'Section', key: 'section' },
        { label: 'Packing Type', key: 'packingType' },
        { label: 'Package Size (Kg)', key: 'packageSize' },
        { label: 'Quantity Produced', key: 'quantityProduced' },
        { label: 'Production Worth', key: 'productionWorth' },
    ];

    return (
        <div className="report-print-area">
            <ReportToolbar
                title={`Daily Production Report for ${filters.date}`}
                exportData={reportData.map(r => ({...r, productionWorth: r.productionWorth.toFixed(2)}))}
                exportHeaders={exportHeaders}
                exportFilename={`DailyProduction_${filters.date}`}
            />
            
            {/* Top Controls & Summary Cards */}
            <div className="p-4 bg-slate-50 rounded-lg border mb-6 flex flex-wrap gap-4 items-center no-print">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                    <input
                        type="date"
                        value={filters.date}
                        onChange={(e) => handleFilterChange('date', e.target.value)}
                        className="p-2 border border-slate-300 rounded-md text-sm"
                    />
                </div>

                {/* Summary Cards */}
                <div className="flex-grow flex gap-4 justify-end">
                    <div className="bg-white p-3 rounded-md border border-slate-200 shadow-sm min-w-[200px]">
                        <p className="text-xs font-semibold text-slate-500 uppercase">Original Opened Worth</p>
                        <p className="text-lg font-bold text-amber-600">{formatCurrency(totalOriginalOpenedWorth)}</p>
                    </div>
                    <div className="bg-white p-3 rounded-md border border-slate-200 shadow-sm min-w-[200px]">
                        <p className="text-xs font-semibold text-slate-500 uppercase">Finished Goods Worth</p>
                        <p className="text-lg font-bold text-green-600">{formatCurrency(totalFinishedGoodsWorth)}</p>
                    </div>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left table-auto text-sm">
                    <thead>
                        <tr className="bg-slate-100">
                            <th className="p-2 font-semibold text-slate-600">Item Name</th>
                            <th className="p-2 font-semibold text-slate-600">Category</th>
                            <th className="p-2 font-semibold text-slate-600">Section</th>
                            <th className="p-2 font-semibold text-slate-600 text-right">Package Size (Kg)</th>
                            <th className="p-2 font-semibold text-slate-600 text-right">Quantity Produced</th>
                            <th className="p-2 font-semibold text-slate-600 text-right">Production Worth</th>
                        </tr>
                    </thead>
                    <tbody>
                        {reportData.map(row => (
                            <tr key={row.id} className="border-b hover:bg-slate-50">
                                <td className="p-2 text-slate-700">{row.itemName} ({row.itemId})</td>
                                <td className="p-2 text-slate-700">{row.category}</td>
                                <td className="p-2 text-slate-700">{row.section}</td>
                                <td className="p-2 text-slate-700 text-right">{row.packageSize}</td>
                                <td className="p-2 text-slate-700 text-right font-medium">{row.quantityProduced.toLocaleString()}</td>
                                <td className="p-2 text-slate-700 text-right font-medium text-green-700">
                                    {formatCurrency(row.productionWorth)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-slate-100 font-bold text-slate-800">
                            <td colSpan={3} className="p-2 text-right">Totals</td>
                            <td className="p-2 text-right"></td>
                            <td className="p-2 text-right">
                                {totalPackages.toLocaleString()} Pkgs / {totalKg.toLocaleString(undefined, { maximumFractionDigits: 2 })} Kg
                            </td>
                            <td className="p-2 text-right text-green-800">
                                {formatCurrency(totalFinishedGoodsWorth)}
                            </td>
                        </tr>
                    </tfoot>
                </table>
                 {reportData.length === 0 && (
                    <p className="text-center text-slate-500 py-6">No production entries for this date.</p>
                )}
            </div>
        </div>
    );
};

export default DailyProductionReport;
