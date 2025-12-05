import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useData } from '../context/DataContext.tsx';
import { 
    OriginalPurchased, FinishedGoodsPurchase, FinishedGoodsPurchaseItem, Supplier, OriginalType, OriginalTypeWithWeight,
    Item, PackingType, Currency, JournalEntry, JournalEntryType, AppState, UserProfile 
} from '../types.ts';
import { generateFinishedGoodsPurchaseId, generateOriginalPurchaseId } from '../utils/idGenerator.ts';
import ItemSelector from './ui/ItemSelector.tsx';
import CurrencyInput from './ui/CurrencyInput.tsx';
import Modal from './ui/Modal.tsx';
import EntitySelector from './ui/EntitySelector.tsx';

// Define default rates for auto-population
const defaultConversionRates: { [key: string]: number } = {
    [Currency.AustralianDollar]: 0.66,
    [Currency.Pound]: 1.34,
    [Currency.AED]: 0.2724795640326975,
    [Currency.SaudiRiyal]: 0.27,
    [Currency.Euro]: 1.17,
    [Currency.Dollar]: 1,
};

// --- Reusable Helper Components ---
const CollapsibleSection: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="border rounded-md bg-slate-50/50">
            <button
                type="button"
                className="w-full flex justify-between items-center p-3 bg-slate-100 hover:bg-slate-200 transition-colors rounded-t-md"
                onClick={() => setIsOpen(!isOpen)}
            >
                <h4 className="font-semibold text-slate-700">{title}</h4>
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-slate-500 transform transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {isOpen && <div className="p-4 space-y-4">{children}</div>}
        </div>
    );
};

// --- Main Purchases Module ---
type PurchaseView = 'original' | 'composite' | 'finishedGoods';

interface PurchasesModuleProps {
    showNotification: (msg: string) => void;
    userProfile: UserProfile | null;
}

const PurchasesModule: React.FC<PurchasesModuleProps> = ({ showNotification, userProfile }) => {
    const [view, setView] = useState<PurchaseView>('original');

    const getButtonClass = (v: PurchaseView) => 
        `px-4 py-2 rounded-md transition-colors text-sm font-medium ${view === v ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'} disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed`;
    
    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-2">
                <h2 className="text-xl font-bold text-slate-700 mr-4">New Purchase</h2>
                <button onClick={() => setView('original')} className={getButtonClass('original')}>Original Purchase</button>
                <button onClick={() => setView('composite')} className={getButtonClass('composite')}>Composite Purchase</button>
                <button onClick={() => setView('finishedGoods')} className={getButtonClass('finishedGoods')} disabled>Finished Goods</button>
            </div>

            <div>
                {view === 'original' && <OriginalPurchaseFormInternal showNotification={showNotification} userProfile={userProfile} />}
                {view === 'composite' && <CompositePurchaseForm showNotification={showNotification} userProfile={userProfile} />}
                {view === 'finishedGoods' && <FinishedGoodsPurchaseFormInternal showNotification={showNotification} userProfile={userProfile} />}
            </div>
        </div>
    );
}


const OriginalPurchaseFormInternal: React.FC<Omit<PurchasesModuleProps, 'selectedSupplierId'>> = ({ showNotification, userProfile }) => {
    const { state, dispatch } = useData();
    const getInitialState = () => {
        const allBatchNumbers = [
            ...state.originalPurchases.map(p => p.batchNumber),
            ...state.finishedGoodsPurchases.map(p => p.batchNumber)
        ];

        const lastNumericBatch = allBatchNumbers
            .filter(bn => bn && /^\d+$/.test(bn))
            .map(bn => parseInt(bn!, 10))
            .sort((a, b) => b - a)[0];

        const newBatchNumber = lastNumericBatch ? String(lastNumericBatch + 1) : '101';

        return {
            date: new Date().toISOString().split('T')[0], supplierId: '', originalTypeId: '', quantityPurchased: undefined,
            rate: undefined, invoiceAmount: undefined as number | undefined, 
            currency: Currency.Dollar, conversionRate: 1, divisionId: '', subDivisionId: '',
            batchNumber: newBatchNumber, containerNumber: '', discountSurcharge: undefined, 
            freightForwarderId: '', freightAmount: undefined,
            clearingAgentId: '', clearingAmount: undefined, 
            commissionAgentId: '', commissionAmount: undefined,
            subSupplierId: '',
            originalProductId: '',
        };
    };

    const [formData, setFormData] = useState<Partial<OriginalPurchased> & { invoiceAmount?: number }>(getInitialState());
    const [freightCurrencyData, setFreightCurrencyData] = useState({ currency: Currency.Dollar, conversionRate: 1 });
    const [clearingCurrencyData, setClearingCurrencyData] = useState({ currency: Currency.Dollar, conversionRate: 1 });
    const [commissionCurrencyData, setCommissionCurrencyData] = useState({ currency: Currency.Dollar, conversionRate: 1 });
    const [originalTypes, setOriginalTypes] = useState<OriginalTypeWithWeight[]>([]);
    const [currentOriginalTypeId, setCurrentOriginalTypeId] = useState('');
    const [currentWeight, setCurrentWeight] = useState<number | ''>('');
    const [currentRate, setCurrentRate] = useState<number | ''>('');

    const [purchaseToSave, setPurchaseToSave] = useState<OriginalPurchased | null>(null);
    const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
    const [hasPrinted, setHasPrinted] = useState(false);

    const availableSubDivisions = useMemo(() => {
        if (!formData.divisionId) return [];
        return state.subDivisions.filter(sd => sd.divisionId === formData.divisionId);
    }, [formData.divisionId, state.subDivisions]);

    const availableSubSuppliers = useMemo(() => {
        if (!formData.supplierId) return [];
        return state.subSuppliers.filter(ss => ss.supplierId === formData.supplierId);
    }, [formData.supplierId, state.subSuppliers]);

    const availableOriginalProducts = useMemo(() => {
        if (!formData.originalTypeId) return [];
        return state.originalProducts.filter(op => op.originalTypeId === formData.originalTypeId);
    }, [formData.originalTypeId, state.originalProducts]);

    useEffect(() => {
        const supplier = state.suppliers.find(s => s.id === formData.supplierId);
        const newCurrency = supplier?.defaultCurrency || Currency.Dollar;
        const newRate = defaultConversionRates[newCurrency] || 1;

        setFormData(prev => ({
            ...prev,
            currency: newCurrency,
            conversionRate: newRate,
            subSupplierId: '',
        }));
    }, [formData.supplierId, state.suppliers]);
    
    useEffect(() => {
        setFormData(prev => ({ ...prev, originalProductId: '' }));
    }, [formData.originalTypeId]);

    // Effects to clear amounts when default agents are selected
    useEffect(() => {
        if (!formData.freightForwarderId) {
            setFormData(prev => ({ ...prev, freightAmount: undefined }));
        }
    }, [formData.freightForwarderId]);

    useEffect(() => {
        if (!formData.clearingAgentId) {
            setFormData(prev => ({ ...prev, clearingAmount: undefined }));
        }
    }, [formData.clearingAgentId]);

    useEffect(() => {
        if (!formData.commissionAgentId) {
            setFormData(prev => ({ ...prev, commissionAmount: undefined }));
        }
    }, [formData.commissionAgentId]);


    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        
        setFormData(prev => {
            const newData: any = { ...prev, [name]: value };
            const qty = parseFloat(String(newData.quantityPurchased || '0'));

            if (name === 'rate') {
                const rateVal = parseFloat(value);
                if (qty > 0 && !isNaN(rateVal) && value !== '') {
                    newData.invoiceAmount = parseFloat((qty * rateVal).toFixed(2));
                } else if (value === '') {
                    newData.invoiceAmount = undefined;
                }
            } else if (name === 'invoiceAmount') {
                const amountVal = parseFloat(value);
                if (qty > 0 && !isNaN(amountVal) && value !== '') {
                    newData.rate = parseFloat((amountVal / qty).toFixed(6));
                } else if (value === '') {
                    newData.rate = undefined;
                }
            } else if (name === 'quantityPurchased') {
                const qVal = parseFloat(value);
                const rVal = parseFloat(String(newData.rate || '0'));
                
                if (!isNaN(qVal) && value !== '' && rVal > 0) {
                    newData.invoiceAmount = parseFloat((qVal * rVal).toFixed(2));
                }
            }

            return newData;
        });
    };

    const handleCurrencyChange = (newCurrency: { currency: Currency; conversionRate: number }) => {
        setFormData(prev => ({ ...prev, ...newCurrency }));
    };

    const handleAddOriginalType = () => {
        if (!currentOriginalTypeId || !currentWeight || Number(currentWeight) <= 0 || !currentRate || Number(currentRate) <= 0) {
            return;
        }
        
        // Check if this original type is already added
        if (originalTypes.some(ot => ot.originalTypeId === currentOriginalTypeId)) {
            return;
        }

        setOriginalTypes([...originalTypes, { 
            originalTypeId: currentOriginalTypeId, 
            weight: Number(currentWeight),
            rate: Number(currentRate)
        }]);
        setCurrentOriginalTypeId('');
        setCurrentWeight('');
        setCurrentRate('');
    };

    const handleRemoveOriginalType = (indexToRemove: number) => {
        setOriginalTypes(originalTypes.filter((_, index) => index !== indexToRemove));
    };

    const handleUpdateOriginalTypeWeight = (indexToUpdate: number, newWeight: string) => {
        const weightAsNumber = parseFloat(newWeight);
        if (newWeight !== '' && (isNaN(weightAsNumber) || weightAsNumber <= 0)) {
            return;
        }

        const updatedTypes = originalTypes.map((item, index) => {
            if (index === indexToUpdate) {
                return { ...item, weight: newWeight === '' ? 0 : weightAsNumber };
            }
            return item;
        });
        setOriginalTypes(updatedTypes);
    };

    const handleUpdateOriginalTypeRate = (indexToUpdate: number, newRate: string) => {
        const rateAsNumber = parseFloat(newRate);
        if (newRate !== '' && (isNaN(rateAsNumber) || rateAsNumber <= 0)) {
            return;
        }

        const updatedTypes = originalTypes.map((item, index) => {
            if (index === indexToUpdate) {
                return { ...item, rate: newRate === '' ? 0 : rateAsNumber };
            }
            return item;
        });
        setOriginalTypes(updatedTypes);
    };
    
    const handlePrepareSummary = (e: React.FormEvent) => {
        e.preventDefault();

        // Validate that at least one original type is selected
        if (originalTypes.length === 0) {
            return;
        }

        const supplier = state.suppliers.find(s => s.id === formData.supplierId);
        const generatedId = generateOriginalPurchaseId(
            state.nextOriginalPurchaseNumber, 
            formData.date!, 
            supplier?.name || 'Unknown'
        );

        const fullPurchaseData: OriginalPurchased = {
            id: generatedId,
            ...getInitialState(),
            ...formData,
            originalTypes: originalTypes, // Use new array instead of single type
            originalTypeId: originalTypes.length > 0 ? originalTypes[0].originalTypeId : '', // Keep for backward compatibility
            quantityPurchased: Number(formData.quantityPurchased) || 0,
            rate: Number(formData.rate) || 0,
            discountSurcharge: Number(formData.discountSurcharge) || 0,
            freightAmount: Number(formData.freightAmount) || 0,
            clearingAmount: Number(formData.clearingAmount) || 0,
            commissionAmount: Number(formData.commissionAmount) || 0,
            freightCurrency: freightCurrencyData.currency,
            freightConversionRate: freightCurrencyData.conversionRate,
            clearingCurrency: clearingCurrencyData.currency,
            clearingConversionRate: clearingCurrencyData.conversionRate,
            commissionCurrency: commissionCurrencyData.currency,
            commissionConversionRate: commissionCurrencyData.conversionRate,
        };
        setPurchaseToSave(fullPurchaseData);
        setHasPrinted(false);
        setIsSummaryModalOpen(true);
    };

    const handleSaveAndContinue = async () => {
        if (!purchaseToSave) return;
        
        // 1. Generate and download PDF
        const { jsPDF } = (window as any).jspdf;
        const html2canvas = (window as any).html2canvas;
        const input = document.getElementById('purchase-voucher-content');
        if (input && jsPDF && html2canvas) {
            const canvas = await html2canvas(input, { scale: 2 });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const imgWidth = canvas.width;
            const imgHeight = canvas.height;
            const ratio = pdfWidth / imgWidth;
            const pdfHeight = imgHeight * ratio;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`PurchaseInvoice_${purchaseToSave.id}.pdf`);
        }

        // 2. Dispatch actions to save data
        dispatch({ type: 'ADD_ENTITY', payload: { entity: 'originalPurchases', data: purchaseToSave } });
        
        const jeDate = purchaseToSave.date;
        const baseDescription = `Purchase from ${state.suppliers.find(s => s.id === purchaseToSave.supplierId)?.name}`;
        
        // Handle journal entries for multiple original types
        let itemValueFC = 0;
        let itemValueUSD = 0;
        
        if (purchaseToSave.originalTypes && purchaseToSave.originalTypes.length > 0) {
            // Calculate from multiple types (new format)
            itemValueFC = purchaseToSave.originalTypes.reduce((sum, ot) => sum + (ot.weight * ot.rate), 0);
            itemValueUSD = (itemValueFC * (purchaseToSave.conversionRate || 1)) + (purchaseToSave.discountSurcharge || 0);
        } else {
            // Fallback to old format for backward compatibility
            itemValueFC = purchaseToSave.quantityPurchased * purchaseToSave.rate;
            itemValueUSD = (itemValueFC * (purchaseToSave.conversionRate || 1)) + (purchaseToSave.discountSurcharge || 0);
        }

        const purchaseDebit: JournalEntry = { id: `je-d-${purchaseToSave.id}`, voucherId: `JV-${purchaseToSave.id}`, date: jeDate, entryType: JournalEntryType.Journal, account: 'EXP-004', debit: itemValueUSD, credit: 0, description: baseDescription };
        const supplierCredit: JournalEntry = { 
            id: `je-c-${purchaseToSave.id}`, voucherId: `JV-${purchaseToSave.id}`, date: jeDate, entryType: JournalEntryType.Journal, account: 'AP-001', 
            debit: 0, credit: itemValueUSD, description: baseDescription, entityId: purchaseToSave.supplierId, entityType: 'supplier',
            originalAmount: purchaseToSave.currency !== Currency.Dollar ? { amount: itemValueFC, currency: purchaseToSave.currency } : undefined,
        };
        dispatch({ type: 'ADD_ENTITY', payload: { entity: 'journalEntries', data: purchaseDebit }});
        dispatch({ type: 'ADD_ENTITY', payload: { entity: 'journalEntries', data: supplierCredit }});

        const costs = [
            { type: 'Freight', id: purchaseToSave.freightForwarderId, amount: purchaseToSave.freightAmount, currencyData: freightCurrencyData, account: 'EXP-005', entityType: 'freightForwarder' as const, name: state.freightForwarders.find(f=>f.id===purchaseToSave.freightForwarderId)?.name },
            { type: 'Clearing', id: purchaseToSave.clearingAgentId, amount: purchaseToSave.clearingAmount, currencyData: clearingCurrencyData, account: 'EXP-006', entityType: 'clearingAgent' as const, name: state.clearingAgents.find(f=>f.id===purchaseToSave.clearingAgentId)?.name },
            { type: 'Commission', id: purchaseToSave.commissionAgentId, amount: purchaseToSave.commissionAmount, currencyData: commissionCurrencyData, account: 'EXP-008', entityType: 'commissionAgent' as const, name: state.commissionAgents.find(f=>f.id===purchaseToSave.commissionAgentId)?.name },
        ];
        
        costs.forEach(cost => {
            if (cost.id && (cost.amount || 0) > 0) {
                const costValueUSD = (cost.amount || 0) * cost.currencyData.conversionRate;
                const costDesc = `${cost.type} for INV ${purchaseToSave.id} from ${cost.name}`;
                const debit: JournalEntry = { id: `je-d-${cost.type.toLowerCase()}-${purchaseToSave.id}`, voucherId: `JV-${purchaseToSave.id}`, date: jeDate, entryType: JournalEntryType.Journal, account: cost.account, debit: costValueUSD, credit: 0, description: costDesc };
                const credit: JournalEntry = { 
                    id: `je-c-${cost.type.toLowerCase()}-${purchaseToSave.id}`, voucherId: `JV-${purchaseToSave.id}`, date: jeDate, entryType: JournalEntryType.Journal, 
                    account: 'AP-001', debit: 0, credit: costValueUSD, description: costDesc, entityId: cost.id, entityType: cost.entityType,
                    originalAmount: cost.currencyData.currency !== Currency.Dollar ? { amount: cost.amount || 0, currency: cost.currencyData.currency } : undefined
                };
                dispatch({ type: 'ADD_ENTITY', payload: { entity: 'journalEntries', data: debit }});
                dispatch({ type: 'ADD_ENTITY', payload: { entity: 'journalEntries', data: credit }});
            }
        });
        
        // 3. Reset and close
        showNotification('Original Purchase Saved!');
        setFormData(getInitialState());
        setIsSummaryModalOpen(false);
        setPurchaseToSave(null);
    };

    const isFreightDisabled = !formData.freightForwarderId;
    const isClearingDisabled = !formData.clearingAgentId;
    const isCommissionDisabled = !formData.commissionAgentId;

    const inputClasses = "mt-1 w-full p-2 rounded-md";

    return (
        <>
            <form onSubmit={handlePrepareSummary} className="space-y-6">
                <div className="border rounded-lg p-4 bg-white">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 border-b pb-2">Core Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div><label className="block text-sm font-medium text-slate-700">Date</label><input type="date" name="date" value={formData.date} onChange={handleChange} required className={`${inputClasses}`}/></div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Supplier</label>
                            <EntitySelector
                                entities={state.suppliers}
                                selectedEntityId={formData.supplierId || ''}
                                onSelect={(id) => handleChange({ target: { name: 'supplierId', value: id } } as any)}
                                placeholder="Search Suppliers..."
                            />
                        </div>
                         <div>
                            <label className="block text-sm font-medium text-slate-700">Sub-Supplier</label>
                            <select name="subSupplierId" value={formData.subSupplierId} onChange={handleChange} disabled={!formData.supplierId || availableSubSuppliers.length === 0} className={`${inputClasses}`}>
                                <option value="">Select Sub-Supplier (Optional)</option>
                                {availableSubSuppliers.map(ss => <option key={ss.id} value={ss.id}>{ss.name}</option>)}
                            </select>
                        </div>
                        <div><label className="block text-sm font-medium text-slate-700">Batch Number</label><input type="text" name="batchNumber" value={formData.batchNumber} onChange={handleChange} disabled className={`${inputClasses} bg-slate-200`}/></div>
                <div className="border rounded-lg p-4 bg-white">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 border-b pb-2">Original Types & Weights</h3>
                    <div className="space-y-4">
                        {/* Add Original Type Form */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-3 bg-slate-50 rounded-md">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Original Type</label>
                                <select 
                                    value={currentOriginalTypeId} 
                                    onChange={(e) => setCurrentOriginalTypeId(e.target.value)} 
                                    className="w-full p-2 rounded-md border border-slate-300"
                                >
                                    <option value="">Select Type</option>
                                    {state.originalTypes.map(ot => (
                                        <option key={ot.id} value={ot.id} disabled={originalTypes.some(x => x.originalTypeId === ot.id)}>
                                            {ot.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Weight (Kg)</label>
                                <input 
                                    type="number" 
                                    value={currentWeight} 
                                    onChange={(e) => setCurrentWeight(e.target.value === '' ? '' : Number(e.target.value))}
                                    placeholder="Enter weight"
                                    className="w-full p-2 rounded-md border border-slate-300"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Rate</label>
                                <input 
                                    type="number" 
                                    step="any"
                                    value={currentRate} 
                                    onChange={(e) => setCurrentRate(e.target.value === '' ? '' : Number(e.target.value))}
                                    placeholder="Enter rate"
                                    className="w-full p-2 rounded-md border border-slate-300"
                                />
                            </div>
                            <div className="flex items-end">
                                <button 
                                    type="button"
                                    onClick={handleAddOriginalType}
                                    disabled={!currentOriginalTypeId || !currentWeight || Number(currentWeight) <= 0 || !currentRate || Number(currentRate) <= 0}
                                    className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-slate-300 font-medium"
                                >
                                    Add Type
                                </button>
                            </div>
                        </div>

                        {/* Display Added Original Types */}
                        {originalTypes.length > 0 ? (
                            <div className="overflow-x-auto border rounded-md">
                                <table className="w-full text-left table-auto">
                                    <thead>
                                        <tr className="bg-slate-100">
                                            <th className="p-3 font-semibold text-slate-600">Original Type</th>
                                            <th className="p-3 font-semibold text-slate-600 text-right">Weight (Kg)</th>
                                            <th className="p-3 font-semibold text-slate-600 text-right">Rate</th>
                                            <th className="p-3 font-semibold text-slate-600 text-right">Total Amount</th>
                                            <th className="p-3 font-semibold text-slate-600 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {originalTypes.map((item, index) => {
                                            const typeDetails = state.originalTypes.find(ot => ot.id === item.originalTypeId);
                                            const totalAmount = item.weight * item.rate;
                                            return (
                                                <tr key={index} className="border-b hover:bg-slate-50">
                                                    <td className="p-3 text-slate-700">{typeDetails?.name || item.originalTypeId}</td>
                                                    <td className="p-3 text-slate-700 text-right">
                                                        <input
                                                            type="number"
                                                            value={item.weight}
                                                            onChange={(e) => handleUpdateOriginalTypeWeight(index, e.target.value)}
                                                            className="w-24 p-2 rounded-md text-right border border-slate-300"
                                                        />
                                                    </td>
                                                    <td className="p-3 text-slate-700 text-right">
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            value={item.rate}
                                                            onChange={(e) => handleUpdateOriginalTypeRate(index, e.target.value)}
                                                            className="w-28 p-2 rounded-md text-right border border-slate-300"
                                                        />
                                                    </td>
                                                    <td className="p-3 text-slate-700 text-right font-medium">{totalAmount.toFixed(2)}</td>
                                                    <td className="p-3 text-right">
                                                        <button 
                                                            type="button"
                                                            onClick={() => handleRemoveOriginalType(index)}
                                                            className="text-red-600 hover:text-red-800 font-semibold text-sm"
                                                        >
                                                            Remove
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-50 font-semibold">
                                            <td className="p-3 text-slate-700">Totals</td>
                                            <td className="p-3 text-slate-700 text-right">{originalTypes.reduce((sum, ot) => sum + ot.weight, 0).toFixed(2)} Kg</td>
                                            <td className="p-3"></td>
                                            <td className="p-3 text-slate-700 text-right">{originalTypes.reduce((sum, ot) => sum + (ot.weight * ot.rate), 0).toFixed(2)}</td>
                                            <td className="p-3"></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        ) : (
                            <div className="text-center p-6 bg-slate-50 rounded-md border-2 border-dashed border-slate-300">
                                <p className="text-slate-500">No original types added yet. Add at least one type above.</p>
                            </div>
                        )}
                    </div>
                </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Original Product</label>
                            <select name="originalProductId" value={formData.originalProductId} onChange={handleChange} disabled={!formData.originalTypeId || availableOriginalProducts.length === 0} className={`${inputClasses}`}>
                                <option value="">Select Product (Optional)</option>
                                {availableOriginalProducts.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="border rounded-lg p-4 bg-white">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 border-b pb-2">Quantity & Pricing</h3>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                        <div><label className="block text-sm font-medium text-slate-700">Quantity</label><input type="number" name="quantityPurchased" value={formData.quantityPurchased || ''} onChange={handleChange} required className={`${inputClasses}`}/></div>
                        <div><label className="block text-sm font-medium text-slate-700">Purchase Rate</label><input type="number" name="rate" step="any" value={formData.rate || ''} onChange={handleChange} required className={`${inputClasses}`}/></div>
                        <div><label className="block text-sm font-medium text-slate-700">Invoice Amount</label><input type="number" name="invoiceAmount" step="any" value={formData.invoiceAmount || ''} onChange={handleChange} className={`${inputClasses}`}/></div>
                        <div className="md:col-span-1"><label className="block text-sm font-medium text-slate-700">Currency</label><CurrencyInput value={{currency: formData.currency!, conversionRate: formData.conversionRate!}} onChange={handleCurrencyChange} /></div>
                        <div><label className="block text-sm font-medium text-slate-700">Discount(-) / Surcharge(+)</label><input type="number" name="discountSurcharge" step="0.01" value={formData.discountSurcharge || ''} onChange={handleChange} className={`${inputClasses}`} placeholder="Amount in USD"/></div>
                    </div>
                </div>
                
                <div className="border rounded-lg p-4 bg-white">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 border-b pb-2">Logistics & Destination</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div><label className="block text-sm font-medium text-slate-700">Container #</label><input type="text" name="containerNumber" value={formData.containerNumber} onChange={handleChange} className={`${inputClasses}`} required /></div>
                        <div><label className="block text-sm font-medium text-slate-700">Division</label><select name="divisionId" value={formData.divisionId} onChange={handleChange} required className={`${inputClasses}`}><option value="">Select Division</option>{state.divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                        <div><label className="block text-sm font-medium text-slate-700">Sub Division</label><select name="subDivisionId" value={formData.subDivisionId} onChange={handleChange} disabled={!formData.divisionId || availableSubDivisions.length === 0} className={`${inputClasses}`}><option value="">Select Sub-Division</option>{availableSubDivisions.map(sd => <option key={sd.id} value={sd.id}>{sd.name}</option>)}</select></div>
                    </div>
                </div>

                <div className="border rounded-lg p-4 bg-white">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 border-b pb-2">Additional Cost</h3>
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-slate-700">Freight Forwarder</label>
                            <select name="freightForwarderId" value={formData.freightForwarderId} onChange={handleChange} className={`w-full p-2 rounded-md`}>
                                <option value="">Select...</option>
                                {state.freightForwarders.map(ff => <option key={ff.id} value={ff.id}>{ff.name}</option>)}
                            </select>
                            <input type="number" name="freightAmount" placeholder="Freight Amount" value={formData.freightAmount || ''} onChange={handleChange} disabled={isFreightDisabled} className={`w-full p-2 rounded-md`} />
                            <CurrencyInput value={freightCurrencyData} onChange={setFreightCurrencyData} disabled={isFreightDisabled} />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-slate-700">Clearing Agent</label>
                            <select name="clearingAgentId" value={formData.clearingAgentId} onChange={handleChange} className={`w-full p-2 rounded-md`}>
                                <option value="">Select...</option>
                                {state.clearingAgents.map(ca => <option key={ca.id} value={ca.id}>{ca.name}</option>)}
                            </select>
                            <input type="number" name="clearingAmount" placeholder="Clearing Amount" value={formData.clearingAmount || ''} onChange={handleChange} disabled={isClearingDisabled} className={`w-full p-2 rounded-md`} />
                            <CurrencyInput value={clearingCurrencyData} onChange={setClearingCurrencyData} disabled={isClearingDisabled} />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-slate-700">Commission Agent</label>
                            <select name="commissionAgentId" value={formData.commissionAgentId} onChange={handleChange} className={`w-full p-2 rounded-md`}>
                                <option value="">Select...</option>
                                {state.commissionAgents.map(ca => <option key={ca.id} value={ca.id}>{ca.name}</option>)}
                            </select>
                            <input type="number" name="commissionAmount" placeholder="Commission Amount" value={formData.commissionAmount || ''} onChange={handleChange} disabled={isCommissionDisabled} className={`w-full p-2 rounded-md`} />
                            <CurrencyInput value={commissionCurrencyData} onChange={setCommissionCurrencyData} disabled={isCommissionDisabled} />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end"><button type="submit" disabled={!formData.supplierId || originalTypes.length === 0} className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300">Finalize Purchase</button></div>
            </form>

            {purchaseToSave && (
                <PurchaseSummaryModal 
                    isOpen={isSummaryModalOpen}
                    onClose={() => setIsSummaryModalOpen(false)}
                    onSave={handleSaveAndContinue}
                    purchase={purchaseToSave}
                    state={state}
                    hasPrinted={hasPrinted}
                    setHasPrinted={setHasPrinted}
                />
            )}
        </>
    );
};

interface FinishedGoodsPurchaseFormProps {
    showNotification: (msg: string) => void;
    userProfile: UserProfile | null;
}

const FinishedGoodsPurchaseFormInternal: React.FC<FinishedGoodsPurchaseFormProps> = ({ showNotification, userProfile }) => {
    // This component is now an alias for StockLotPurchaseForm, but keeping the structure for clarity
    // In a real refactor, this would be removed and StockLotPurchaseForm would be used directly.
    return <div className="text-slate-500">This feature has been integrated into the "Stock-Lot / Bundle Purchase" module.</div>
};

// --- Modals for Purchase Summaries and Print ---
interface PurchaseSummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    purchase: OriginalPurchased;
    state: AppState;
    hasPrinted: boolean;
    setHasPrinted: (p: boolean) => void;
}

interface FinishedGoodsPurchaseSummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    purchase: FinishedGoodsPurchase;
    state: AppState;
    hasPrinted: boolean;
    setHasPrinted: (p: boolean) => void;
}

const PurchaseSummaryModal: React.FC<PurchaseSummaryModalProps> = ({ isOpen, onClose, onSave, purchase, state, hasPrinted, setHasPrinted }) => {
    
    const handlePrint = () => {
        window.print();
        setHasPrinted(true);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Purchase Summary" size="4xl">
            <PrintablePurchaseVoucher purchase={purchase} state={state} />
            <div className="flex justify-end pt-6 space-x-2 no-print">
                <button onClick={onClose} className="px-4 py-2 bg-slate-200 text-slate-800 rounded-md hover:bg-slate-300">
                    {hasPrinted ? 'Cancel Entry' : 'Cancel'}
                </button>
                <button onClick={handlePrint} disabled={hasPrinted} className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-300">
                    Print
                </button>
                <button onClick={onSave} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                    {hasPrinted ? 'Save & Exit' : 'Save & Continue'}
                </button>
            </div>
        </Modal>
    );
};

const PrintablePurchaseVoucher: React.FC<{ purchase: OriginalPurchased, state: AppState }> = ({ purchase, state }) => {
    const { supplierId, originalTypeId, date, rate, quantityPurchased, currency, conversionRate, discountSurcharge, originalTypes } = purchase;
    const supplier = state.suppliers.find(s => s.id === supplierId);
    const subSupplier = state.subSuppliers.find(ss => ss.id === purchase.subSupplierId);
    const originalType = state.originalTypes.find(ot => ot.id === originalTypeId);
    const originalProduct = state.originalProducts.find(op => op.id === purchase.originalProductId);
    
    // Check if we have multiple original types with weights and rates
    const hasMultipleTypes = originalTypes && originalTypes.length > 0;
    
    let itemValueFC = 0;
    let itemValueUSD = 0;

    if (hasMultipleTypes && originalTypes) {
        // Calculate from multiple types (new format)
        itemValueFC = originalTypes.reduce((sum, ot) => sum + (ot.weight * ot.rate), 0);
        itemValueUSD = itemValueFC * (conversionRate || 1) + (discountSurcharge || 0);
    } else {
        // Fallback to old format for backward compatibility
        itemValueFC = quantityPurchased * rate;
        itemValueUSD = itemValueFC * (conversionRate || 1) + (discountSurcharge || 0);
    }

    const freightValueUSD = (purchase.freightAmount || 0) * (purchase.freightConversionRate || 1);
    const clearingValueUSD = (purchase.clearingAmount || 0) * (purchase.clearingConversionRate || 1);
    const commissionValueUSD = (purchase.commissionAmount || 0) * (purchase.commissionConversionRate || 1);
    
    const totalValueUSD = itemValueUSD + freightValueUSD + clearingValueUSD + commissionValueUSD;
    
    const costs = [
        { label: 'Freight', name: state.freightForwarders.find(e => e.id === purchase.freightForwarderId)?.name, amount: purchase.freightAmount, currency: purchase.freightCurrency },
        { label: 'Clearing', name: state.clearingAgents.find(e => e.id === purchase.clearingAgentId)?.name, amount: purchase.clearingAmount, currency: purchase.clearingCurrency },
        { label: 'Commission', name: state.commissionAgents.find(e => e.id === purchase.commissionAgentId)?.name, amount: purchase.commissionAmount, currency: purchase.commissionCurrency },
    ].filter(c => c.amount && c.amount > 0);

    return (
        <div id="purchase-voucher-content" className="p-4 bg-white font-sans text-sm">
            <h2 className="text-xl font-bold text-center text-slate-900">Purchase Voucher</h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 mt-4 border-b pb-2 text-slate-700">
                <p><strong>ID:</strong> {purchase.id}</p>
                <p><strong>Date:</strong> {date}</p>
                <p><strong>Supplier:</strong> {supplier?.name} {subSupplier ? `(${subSupplier.name})` : ''}</p>
                <p><strong>Batch No:</strong> {purchase.batchNumber}</p>
                <p><strong>Container No:</strong> {purchase.containerNumber || 'N/A'}</p>
            </div>
            
            {hasMultipleTypes && originalTypes && originalTypes.length > 0 ? (
                <>
                    <h3 className="font-semibold text-slate-800 mt-4 mb-2">Original Types & Weights</h3>
                    <table className="w-full text-left my-4">
                        <thead className="border-b">
                            <tr className="bg-slate-50">
                                <th className="p-1 font-semibold text-slate-600">Original Type</th>
                                <th className="p-1 font-semibold text-slate-600 text-right">Weight (Kg)</th>
                                <th className="p-1 font-semibold text-slate-600 text-right">Rate ({currency})</th>
                                <th className="p-1 font-semibold text-slate-600 text-right">Total ({currency})</th>
                            </tr>
                        </thead>
                        <tbody>
                            {originalTypes.map((ot, idx) => {
                                const typeDetail = state.originalTypes.find(x => x.id === ot.originalTypeId);
                                const typeTotal = ot.weight * ot.rate;
                                return (
                                    <tr key={idx}>
                                        <td className="p-1 text-slate-800">{typeDetail?.name || ot.originalTypeId} {originalProduct ? `- ${originalProduct.name}` : ''}</td>
                                        <td className="p-1 text-slate-800 text-right">{ot.weight.toFixed(2)}</td>
                                        <td className="p-1 text-slate-800 text-right">{ot.rate.toFixed(2)}</td>
                                        <td className="p-1 text-slate-800 text-right">{typeTotal.toFixed(2)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="border-t">
                            <tr className="bg-slate-50">
                                <td className="p-1 font-semibold text-slate-700">Totals</td>
                                <td className="p-1 font-semibold text-slate-700 text-right">{originalTypes.reduce((s, ot) => s + ot.weight, 0).toFixed(2)}</td>
                                <td className="p-1"></td>
                                <td className="p-1 font-semibold text-slate-700 text-right">{itemValueFC.toFixed(2)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </>
            ) : (
                <table className="w-full text-left my-4">
                    <thead className="border-b">
                        <tr className="bg-slate-50">
                            <th className="p-1 font-semibold text-slate-600">Description</th>
                            <th className="p-1 font-semibold text-slate-600 text-right">Qty</th>
                            <th className="p-1 font-semibold text-slate-600 text-right">Rate ({currency})</th>
                            <th className="p-1 font-semibold text-slate-600 text-right">Total ({currency})</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td className="p-1 text-slate-800">{originalType?.name} {originalProduct ? `- ${originalProduct.name}` : ''}</td>
                            <td className="p-1 text-slate-800 text-right">{quantityPurchased.toLocaleString()}</td>
                            <td className="p-1 text-slate-800 text-right">{rate.toFixed(2)}</td>
                            <td className="p-1 text-slate-800 text-right">{itemValueFC.toFixed(2)}</td>
                        </tr>
                    </tbody>
                </table>
            )}
            
            {costs.length > 0 && (<>
                <h4 className="font-semibold mt-2 text-slate-800">Additional Costs</h4>
                <table className="w-full text-left my-2 text-xs">
                    <tbody>
                        {costs.map(c => (
                            <tr key={c.label}>
                                <td className="p-1 text-slate-700">{c.label} ({c.name})</td>
                                <td className="p-1 text-slate-700 text-right">{c.amount?.toFixed(2)} {c.currency}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </>)}
            <div className="text-right font-bold text-lg bg-slate-100 p-2 rounded-md mt-4 text-slate-900">
                Grand Total (USD): ${totalValueUSD.toFixed(2)}
            </div>
        </div>
    );
};


// Step 2: Composite Purchase Form (Main supplier + multi sub-suppliers)
interface CompositePurchaseFormProps {
    showNotification: (msg: string) => void;
    userProfile: UserProfile | null;
}

const CompositePurchaseForm: React.FC<CompositePurchaseFormProps> = ({ showNotification, userProfile }) => {
    const { state, dispatch } = useData();


    const [mainSupplierId, setMainSupplierId] = useState('');
    const [selectedSubSupplierIds, setSelectedSubSupplierIds] = useState<string[]>([]);
    // Only show suppliers who have at least one sub-supplier
    const supplierOptions = state.suppliers
        .filter(s => state.subSuppliers.some(ss => ss.supplierId === s.id))
        .map(s => ({ value: s.id, label: s.name }));
    // Sub-supplier options filtered by main supplier
    const subSupplierOptions = state.subSuppliers
        .filter(ss => !mainSupplierId || ss.supplierId === mainSupplierId)
        .map(ss => ({ value: ss.id, label: ss.name }));
    // Auto-populate main invoice number and date as in original purchase form
    const allBatchNumbers = [
        ...state.originalPurchases.map(p => p.batchNumber),
        ...state.finishedGoodsPurchases.map(p => p.batchNumber)
    ];
    const lastNumericBatch = allBatchNumbers
        .filter(bn => bn && /^\d+$/.test(bn))
        .map(bn => parseInt(bn, 10))
        .sort((a, b) => b - a)[0];
    const nextBatchNumber = lastNumericBatch ? String(lastNumericBatch + 1) : '101';
    const [mainInvoiceNumber, setMainInvoiceNumber] = useState(nextBatchNumber);
    const [mainInvoiceDate, setMainInvoiceDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    // Track invoice details for each sub-supplier (mirroring original purchase fields)
    const todayStr = new Date().toISOString().split('T')[0];
    const [subSupplierInvoices, setSubSupplierInvoices] = useState<Record<string, {
        invoiceNumber: string;
        date: string;
        originalTypeId: string;
        originalProductId: string;
        quantityPurchased: string;
        rate: string;
        amount: string;
        currency: Currency;
        conversionRate: string;
    }>>({});



    // Helper for sub-supplier invoice field change with auto-calc
    const handleSubSupplierInvoiceChange = (id: string, field: string, value: string) => {
        setSubSupplierInvoices(prev => {
            const invoice = prev[id] || {};
            let { quantityPurchased = '', rate = '', amount = '' } = invoice;
            if (field === 'quantityPurchased') quantityPurchased = value;
            if (field === 'rate') rate = value;
            if (field === 'amount') amount = value;
            // Auto-calc logic
            if (field === 'rate' || field === 'quantityPurchased') {
                const q = parseFloat(quantityPurchased || '0');
                const r = parseFloat(rate || '0');
                if (q > 0 && r > 0) {
                    amount = (q * r).toFixed(2);
                }
            }
            if (field === 'amount' || field === 'quantityPurchased') {
                const q = parseFloat(quantityPurchased || '0');
                const a = parseFloat(amount || '0');
                if (q > 0 && a > 0 && (field === 'amount' || field === 'quantityPurchased')) {
                    rate = (a / q).toFixed(6);
                }
            }
            return {
                ...prev,
                [id]: {
                    ...invoice,
                    [field]: value,
                    quantityPurchased,
                    rate,
                    amount,
                },
            };
        });
    };

    // Additional cost section state
    // Expanded Additional Cost section state
    const [additionalCosts, setAdditionalCosts] = useState({
        freight: { agentId: '', amount: '', currency: Currency.Dollar, conversionRate: '1' },
        clearing: { agentId: '', amount: '', currency: Currency.Dollar, conversionRate: '1' },
        commission: { agentId: '', amount: '', currency: Currency.Dollar, conversionRate: '1' },
    });



    if (supplierOptions.length === 0) {
        return (
            <div className="p-6 border rounded bg-yellow-50 text-yellow-900 mt-8">
                <h3 className="text-lg font-bold mb-2">No suppliers with sub-suppliers found</h3>
                <p>Please add suppliers and sub-suppliers in the Setup module before using Composite Purchase.</p>
            </div>
        );
    }

    // Handle sub-supplier selection (multi-select)
    const handleSubSupplierChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const options = Array.from(e.target.selectedOptions) as HTMLOptionElement[];
        const ids = options.map(opt => opt.value);
        setSelectedSubSupplierIds(ids);
        // Remove invoice data for unselected sub-suppliers
        setSubSupplierInvoices(prev => {
            const updated: typeof prev = {};
            ids.forEach(id => {
                updated[id] = prev[id] || {
                    invoiceNumber: '',
                    date: todayStr,
                    originalTypeId: '',
                    originalProductId: '',
                    quantityPurchased: '',
                    rate: '',
                    amount: '',
                    currency: Currency.AED, // Default to AED
                    conversionRate: defaultConversionRates[Currency.AED].toString(), // Default AED rate
                };
            });
            return updated;
        });
    };

    return (
        <>
            <div className="mt-6 max-w-xl grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium mb-1">Main Invoice Number</label>
                    <input
                        type="text"
                        className="w-full border rounded p-2 mb-2"
                        value={mainInvoiceNumber}
                        onChange={e => setMainInvoiceNumber(e.target.value)}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">Main Invoice Date</label>
                    <input
                        type="date"
                        className="w-full border rounded p-2 mb-2"
                        value={mainInvoiceDate}
                        onChange={e => setMainInvoiceDate(e.target.value)}
                    />
                </div>
            </div>
            <div className="mt-6 max-w-xl">
                <label className="block text-sm font-medium mb-1">Main Supplier</label>
                <select
                    className="w-full border rounded p-2 mb-4"
                    value={mainSupplierId}
                    onChange={e => {
                        setMainSupplierId(e.target.value);
                        setSelectedSubSupplierIds([]);
                    }}
                >
                    <option value="">Select main supplier...</option>
                    {supplierOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>
            {mainSupplierId && (
                <div className="mt-4 max-w-xl">
                    <label className="block text-sm font-medium mb-1">Sub-Suppliers</label>
                    <select
                        className="w-full border rounded p-2 mb-4"
                        multiple
                        value={selectedSubSupplierIds}
                        onChange={handleSubSupplierChange}
                        size={Math.max(2, subSupplierOptions.length)}
                    >
                        {subSupplierOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>
            )}
            {selectedSubSupplierIds.length > 0 && (
                <div className="mt-6 space-y-6">
                    <h4 className="font-semibold mb-2">Sub-Supplier Invoices</h4>
                    {selectedSubSupplierIds.map(id => {
                        const ss = state.subSuppliers.find(s => s.id === id);
                        const invoice = subSupplierInvoices[id] || {
                            invoiceNumber: '',
                            date: todayStr,
                            originalTypeId: '',
                            originalProductId: '',
                            quantityPurchased: '',
                            rate: '',
                            amount: '',
                            currency: Currency.Dollar,
                            conversionRate: '1',
                        };
                        // Get product options for this sub-supplier
                        const originalTypeOptions = state.originalTypes.map(ot => ({ value: ot.id, label: ot.name }));
                        const productOptions = invoice.originalTypeId
                            ? state.originalProducts.filter(op => op.originalTypeId === invoice.originalTypeId).map(op => ({ value: op.id, label: op.name }))
                            : [];
                        return (
                            <div key={id} className="border rounded p-4 bg-white">
                                <div className="font-semibold mb-2">{ss?.name || id}</div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {/* Removed Invoice Number and Date fields as requested */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Original Type</label>
                                        <select
                                            className="w-full border rounded p-2"
                                            value={invoice.originalTypeId}
                                            onChange={e => setSubSupplierInvoices(prev => ({ ...prev, [id]: { ...invoice, originalTypeId: e.target.value, originalProductId: '' } }))}
                                        >
                                            <option value="">Select type...</option>
                                            {originalTypeOptions.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Product</label>
                                        <select
                                            className="w-full border rounded p-2"
                                            value={invoice.originalProductId}
                                            onChange={e => setSubSupplierInvoices(prev => ({ ...prev, [id]: { ...invoice, originalProductId: e.target.value } }))}
                                            disabled={!invoice.originalTypeId}
                                        >
                                            <option value="">Select product...</option>
                                            {productOptions.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Quantity</label>
                                        <input
                                            type="number"
                                            className="w-full border rounded p-2"
                                            value={invoice.quantityPurchased}
                                            onChange={e => handleSubSupplierInvoiceChange(id, 'quantityPurchased', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Rate (AED)</label>
                                        <input
                                            type="number"
                                            className="w-full border rounded p-2"
                                            value={invoice.rate}
                                            onChange={e => handleSubSupplierInvoiceChange(id, 'rate', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Amount</label>
                                        <input
                                            type="number"
                                            className="w-full border rounded p-2"
                                            value={invoice.amount}
                                            onChange={e => handleSubSupplierInvoiceChange(id, 'amount', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Currency</label>
                                        <select
                                            className="w-full border rounded p-2"
                                            value={invoice.currency}
                                            onChange={e => setSubSupplierInvoices(prev => ({ ...prev, [id]: { ...invoice, currency: e.target.value as Currency } }))}
                                        >
                                            {Object.values(Currency).map(cur => (
                                                <option key={cur} value={cur}>{cur}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Conversion Rate</label>
                                        <input
                                            type="number"
                                            className="w-full border rounded p-2"
                                            value={invoice.conversionRate}
                                            onChange={e => setSubSupplierInvoices(prev => ({ ...prev, [id]: { ...invoice, conversionRate: e.target.value } }))}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
				})}
			</div>
            )}


            {/* Additional Cost Section */}
            {selectedSubSupplierIds.length > 0 && (
                <>
                <div className="mt-8 border-t pt-6">
                    <h4 className="font-semibold mb-2">Additional Costs</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Freight */}
                        <div className="border rounded p-3 bg-slate-50">
                            <label className="block text-sm font-medium mb-1">Freight Forwarder</label>
                            <select
                                className="w-full border rounded p-2 mb-2"
                                value={additionalCosts.freight.agentId}
                                onChange={e => setAdditionalCosts(c => ({ ...c, freight: { ...c.freight, agentId: e.target.value } }))}
                            >
                                <option value="">Select Forwarder...</option>
                                {state.freightForwarders.map(f => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                            <label className="block text-xs mb-1">Amount</label>
                            <input
                                type="number"
                                className="w-full border rounded p-2 mb-2"
                                value={additionalCosts.freight.amount}
                                onChange={e => setAdditionalCosts(c => ({ ...c, freight: { ...c.freight, amount: e.target.value } }))}
                            />
                            <label className="block text-xs mb-1">Currency</label>
                            <select
                                className="w-full border rounded p-2 mb-2"
                                value={additionalCosts.freight.currency}
                                onChange={e => setAdditionalCosts(c => ({ ...c, freight: { ...c.freight, currency: e.target.value as Currency } }))}
                            >
                                {Object.values(Currency).map(cur => (
                                    <option key={cur} value={cur}>{cur}</option>
                                ))}
                            </select>
                            <label className="block text-xs mb-1">Conversion Rate</label>
                            <input
                                type="number"
                                className="w-full border rounded p-2"
                                value={additionalCosts.freight.conversionRate}
                                onChange={e => setAdditionalCosts(c => ({ ...c, freight: { ...c.freight, conversionRate: e.target.value } }))}
                            />
                        </div>
                        {/* Clearing */}
                        <div className="border rounded p-3 bg-slate-50">
                            <label className="block text-sm font-medium mb-1">Clearing Agent</label>
                            <select
                                className="w-full border rounded p-2 mb-2"
                                value={additionalCosts.clearing.agentId}
                                onChange={e => setAdditionalCosts(c => ({ ...c, clearing: { ...c.clearing, agentId: e.target.value } }))}
                            >
                                <option value="">Select Agent...</option>
                                {state.clearingAgents.map(f => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                            <label className="block text-xs mb-1">Amount</label>
                            <input
                                type="number"
                                className="w-full border rounded p-2 mb-2"
                                value={additionalCosts.clearing.amount}
                                onChange={e => setAdditionalCosts(c => ({ ...c, clearing: { ...c.clearing, amount: e.target.value } }))}
                            />
                            <label className="block text-xs mb-1">Currency</label>
                            <select
                                className="w-full border rounded p-2 mb-2"
                                value={additionalCosts.clearing.currency}
                                onChange={e => setAdditionalCosts(c => ({ ...c, clearing: { ...c.clearing, currency: e.target.value as Currency } }))}
                            >
                                {Object.values(Currency).map(cur => (
                                    <option key={cur} value={cur}>{cur}</option>
                                ))}
                            </select>
                            <label className="block text-xs mb-1">Conversion Rate</label>
                            <input
                                type="number"
                                className="w-full border rounded p-2"
                                value={additionalCosts.clearing.conversionRate}
                                onChange={e => setAdditionalCosts(c => ({ ...c, clearing: { ...c.clearing, conversionRate: e.target.value } }))}
                            />
                        </div>
                        {/* Commission */}
                        <div className="border rounded p-3 bg-slate-50">
                            <label className="block text-sm font-medium mb-1">Commission Agent</label>
                            <select
                                className="w-full border rounded p-2 mb-2"
                                value={additionalCosts.commission.agentId}
                                onChange={e => setAdditionalCosts(c => ({ ...c, commission: { ...c.commission, agentId: e.target.value } }))}
                            >
                                <option value="">Select Agent...</option>
                                {state.commissionAgents.map(f => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                            <label className="block text-xs mb-1">Amount</label>
                            <input
                                type="number"
                                className="w-full border rounded p-2 mb-2"
                                value={additionalCosts.commission.amount}
                                onChange={e => setAdditionalCosts(c => ({ ...c, commission: { ...c.commission, amount: e.target.value } }))}
                            />
                            <label className="block text-xs mb-1">Currency</label>
                            <select
                                className="w-full border rounded p-2 mb-2"
                                value={additionalCosts.commission.currency}
                                onChange={e => setAdditionalCosts(c => ({ ...c, commission: { ...c.commission, currency: e.target.value as Currency } }))}
                            >
                                {Object.values(Currency).map(cur => (
                                    <option key={cur} value={cur}>{cur}</option>
                                ))}
                            </select>
                            <label className="block text-xs mb-1">Conversion Rate</label>
                            <input
                                type="number"
                                className="w-full border rounded p-2"
                                value={additionalCosts.commission.conversionRate}
                                onChange={e => setAdditionalCosts(c => ({ ...c, commission: { ...c.commission, conversionRate: e.target.value } }))}
                            />
                        </div>
                    </div>
                </div>
                {/* Save & Preview Button */}
                <div className="mt-8 flex justify-end">
                    <button
                        className="px-6 py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700"
                        onClick={() => setIsPreviewOpen(true)}
                    >
                        Save & Preview
                    </button>
                </div>
                </>
            )}

            {/* Preview Modal */}
            {isPreviewOpen && (
                <Modal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} title="Composite Purchase Preview" size="xl">
                    <div className="p-4 print:bg-white">
                        <h2 className="text-xl font-bold mb-2">Composite Purchase Voucher</h2>
                        <div className="mb-2 flex flex-wrap gap-8">
                            <div><strong>Main Invoice #:</strong> {mainInvoiceNumber}</div>
                            <div><strong>Date:</strong> {mainInvoiceDate}</div>
                            <div><strong>Main Supplier:</strong> {supplierOptions.find(s => s.value === mainSupplierId)?.label || ''}</div>
                        </div>
                        <hr className="my-2" />
                        <h3 className="font-semibold mb-2">Sub-Supplier Invoices</h3>
                        {selectedSubSupplierIds.map(id => {
                            const ss = state.subSuppliers.find(s => s.id === id);
                            const invoice = subSupplierInvoices[id];
                            const originalType = state.originalTypes.find(ot => ot.id === invoice.originalTypeId)?.name || '';
                            const product = state.originalProducts.find(op => op.id === invoice.originalProductId)?.name || '';
                            return (
                                <div key={id} className="mb-4 border-b pb-2">
                                    <div className="font-semibold">{ss?.name || id}</div>
                                    <div className="flex flex-wrap gap-6 text-sm mt-1">
                                        <div><strong>Invoice #:</strong> {invoice.invoiceNumber}</div>
                                        <div><strong>Date:</strong> {invoice.date}</div>
                                        <div><strong>Type:</strong> {originalType}</div>
                                        <div><strong>Product:</strong> {product}</div>
                                        <div><strong>Qty:</strong> {invoice.quantityPurchased}</div>
                                        <div><strong>Rate:</strong> {invoice.rate}</div>
                                        <div><strong>Amount:</strong> {invoice.amount}</div>
                                        <div><strong>Currency:</strong> {invoice.currency}</div>
                                        <div><strong>Conv. Rate:</strong> {invoice.conversionRate}</div>
                                    </div>
                                </div>
                            );
                        })}
                        {/* Additional Cost Summary */}
                        <div className="mt-4">
                            <h4 className="font-semibold mb-1">Additional Costs</h4>
                            <div className="flex flex-wrap gap-8 text-sm">
                                <div><strong>Freight:</strong> {additionalCosts.freight.amount || 0} {additionalCosts.freight.currency} {state.freightForwarders.find(f => f.id === additionalCosts.freight.agentId)?.name ? `(${state.freightForwarders.find(f => f.id === additionalCosts.freight.agentId)?.name})` : ''}</div>
                                <div><strong>Clearing:</strong> {additionalCosts.clearing.amount || 0} {additionalCosts.clearing.currency} {state.clearingAgents.find(f => f.id === additionalCosts.clearing.agentId)?.name ? `(${state.clearingAgents.find(f => f.id === additionalCosts.clearing.agentId)?.name})` : ''}</div>
                                <div><strong>Commission:</strong> {additionalCosts.commission.amount || 0} {additionalCosts.commission.currency} {state.commissionAgents.find(f => f.id === additionalCosts.commission.agentId)?.name ? `(${state.commissionAgents.find(f => f.id === additionalCosts.commission.agentId)?.name})` : ''}</div>
                            </div>
                        </div>
                        {/* Total Calculation */}
                        <div className="mt-6 text-right text-lg font-bold">
                            {(() => {
                                const invoiceTotal = selectedSubSupplierIds.reduce((sum, id) => sum + (parseFloat(subSupplierInvoices[id]?.amount || '0') || 0), 0);
                                const addCost = ['freight','clearing','commission'].reduce((sum, k) => sum + (parseFloat(additionalCosts[k].amount || '0') || 0), 0);
                                return `Grand Total: $${(invoiceTotal + addCost).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;
                            })()}
                        </div>
                        <div className="mt-6 flex justify-end gap-4">
                            <button
                                className="px-4 py-2 bg-slate-200 text-slate-800 rounded hover:bg-slate-300"
                                onClick={() => setIsPreviewOpen(false)}
                            >
                                Close
                            </button>
                            <button
                                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 print:hidden"
                                onClick={() => window.print()}
                            >
                                Print
                            </button>
                            <button
                                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-semibold"
                                onClick={() => {
                                    // Save composite purchase logic
                                    const supplier = state.suppliers.find(s => s.id === mainSupplierId);
                                    // --- Save all sub-supplier purchases as before ---
                                    const purchaseId = generateOriginalPurchaseId(state.nextOriginalPurchaseNumber, mainInvoiceDate, supplier?.name || 'Unknown');
                                    let totalAmountUSD = 0;
                                    let totalAmountFC = 0;
                                    let mainCurrency = 'Dollar';
                                    let jeDate = mainInvoiceDate;
                                    selectedSubSupplierIds.forEach(id => {
                                        const invoice = subSupplierInvoices[id];
                                        if (!invoice) return;
                                        const purchaseObj = {
                                            id: purchaseId + '-' + id,
                                            mainInvoiceNumber,
                                            mainInvoiceDate,
                                            mainSupplierId,
                                            subSupplierId: id,
                                            ...invoice,
                                            additionalCosts,
                                            createdAt: new Date().toISOString(),
                                            createdBy: userProfile?.uid || '',
                                        };
                                        dispatch({
                                            type: 'ADD_ENTITY',
                                            payload: { entity: 'originalPurchases', data: purchaseObj }
                                        });
                                        // Sum for main journal entry
                                        const qty = parseFloat(invoice.quantityPurchased || '0');
                                        const rate = parseFloat(invoice.rate || '0');
                                        const amountFC = qty * rate;
                                        const conversionRate = parseFloat(invoice.conversionRate || '1');
                                        const amountUSD = amountFC * conversionRate;
                                        totalAmountUSD += amountUSD;
                                        totalAmountFC += amountFC;
                                        mainCurrency = invoice.currency;
                                        jeDate = invoice.date;
                                    });
                                    // --- Main Journal Entries (one for all) ---
                                    const baseDescription = `Composite Purchase from ${supplier?.name || mainSupplierId}`;
                                    dispatch({
                                        type: 'ADD_ENTITY',
                                        payload: {
                                            entity: 'journalEntries',
                                            data: {
                                                id: `je-d-${purchaseId}`,
                                                voucherId: `JV-${purchaseId}`,
                                                date: jeDate,
                                                entryType: 'Journal',
                                                account: 'EXP-004',
                                                debit: totalAmountUSD,
                                                credit: 0,
                                                description: baseDescription,
                                                entityId: mainSupplierId,
                                                entityType: 'supplier', // Only supplier
                                                originalAmount: mainCurrency !== 'Dollar' ? { amount: totalAmountFC, currency: mainCurrency } : undefined,
                                                createdBy: userProfile?.uid || '',
                                            }
                                        }
                                    });
                                    dispatch({
                                        type: 'ADD_ENTITY',
                                        payload: {
                                            entity: 'journalEntries',
                                            data: {
                                                id: `je-c-${purchaseId}`,
                                                voucherId: `JV-${purchaseId}`,
                                                date: jeDate,
                                                entryType: 'Journal',
                                                account: 'AP-001',
                                                debit: 0,
                                                credit: totalAmountUSD,
                                                description: baseDescription,
                                                entityId: mainSupplierId,
                                                entityType: 'supplier', // Only supplier
                                                originalAmount: mainCurrency !== 'Dollar' ? { amount: totalAmountFC, currency: mainCurrency } : undefined,
                                                createdBy: userProfile?.uid || '',
                                            }
                                        }
                                    });
                                    // --- Additional Costs (Freight, Clearing, Commission) ---
                                    const addCosts = [
                                        { key: 'freight', label: 'Freight', agentArr: state.freightForwarders, expAccount: 'EXP-005' },
                                        { key: 'clearing', label: 'Clearing', agentArr: state.clearingAgents, expAccount: 'EXP-006' },
                                        { key: 'commission', label: 'Commission', agentArr: state.commissionAgents, expAccount: 'EXP-008' },
                                    ];
                                    addCosts.forEach(cost => {
                                        const c = additionalCosts[cost.key];
                                        if (c && c.agentId && parseFloat(c.amount || '0') > 0) {
                                            const agent = cost.agentArr.find(a => a.id === c.agentId);
                                            const costAmountFC = parseFloat(c.amount || '0');
                                            const costConvRate = parseFloat(c.conversionRate || '1');
                                            const costAmountUSD = costAmountFC * costConvRate;
                                            const desc = `${cost.label} for INV ${mainInvoiceNumber} (${agent?.name || c.agentId})`;
                                            // Map correct entityType for report filtering
                                            let entityType = '';
                                            if (cost.key === 'freight') entityType = 'freightForwarder';
                                            else if (cost.key === 'clearing') entityType = 'clearingAgent';
                                            else if (cost.key === 'commission') entityType = 'commissionAgent';
                                            // Debit: Expense
                                            dispatch({
                                                type: 'ADD_ENTITY',
                                                payload: {
                                                    entity: 'journalEntries',
                                                    data: {
                                                        id: `je-d-${cost.key}-${purchaseId}`,
                                                        voucherId: `JV-${purchaseId}`,
                                                        date: jeDate,
                                                        entryType: 'Journal',
                                                        account: cost.expAccount,
                                                        debit: costAmountUSD,
                                                        credit: 0,
                                                        description: desc,
                                                        entityId: c.agentId,
                                                        entityType,
                                                        originalAmount: c.currency !== 'Dollar' ? { amount: costAmountFC, currency: c.currency } : undefined,
                                                        createdBy: userProfile?.uid || '',
                                                    }
                                                }
                                            });
                                            // Credit: Accounts Payable
                                            dispatch({
                                                type: 'ADD_ENTITY',
                                                payload: {
                                                    entity: 'journalEntries',
                                                    data: {
                                                        id: `je-c-${cost.key}-${purchaseId}`,
                                                        voucherId: `JV-${purchaseId}`,
                                                        date: jeDate,
                                                        entryType: 'Journal',
                                                        account: 'AP-001',
                                                        debit: 0,
                                                        credit: costAmountUSD,
                                                        description: desc,
                                                        entityId: c.agentId,
                                                        entityType,
                                                        originalAmount: c.currency !== 'Dollar' ? { amount: costAmountFC, currency: c.currency } : undefined,
                                                        createdBy: userProfile?.uid || '',
                                                    }
                                                }
                                            });
                                        }
                                    });
                                    showNotification('Composite purchase saved successfully!');
                                    setIsPreviewOpen(false);
                                    // Optionally reset form fields here
                                }}
                            >
                                Confirm & Continue
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
};


export default PurchasesModule;
