
import React, { useState, useEffect, useMemo, useReducer } from 'react';
import { useData } from '../context/DataContext.tsx';
import { InvoiceStatus, PackingType } from '../types.ts';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, Line, ComposedChart, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';

// --- Custom Tooltip Components for Professional Look ---
const CustomTooltip = ({ active, payload, label, formatter }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-slate-800 border border-slate-700 p-3 rounded-lg shadow-2xl">
                <p className="text-slate-300 text-xs font-semibold mb-2">{label}</p>
                {payload.map((entry: any, index: number) => (
                    <div key={index} className="flex items-center gap-2 text-sm mb-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="text-slate-400">{entry.name}:</span>
                        <span className="text-slate-100 font-medium">
                            {formatter ? formatter(entry.value) : entry.value}
                        </span>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

const AnalyticsDashboard: React.FC = () => {
    const { state } = useData();
    const [, forceUpdate] = useReducer(x => x + 1, 0);

    // Ensure Recharts is loaded
    useEffect(() => {
        // Force update to ensure charts render if loaded dynamically
        forceUpdate();
    }, []);

    // --- 1. Deep Data Processing & Insights ---

    const kpis = useMemo(() => {
        const revenueEntries = state.journalEntries.filter(je => je.account === 'REV-001');
        const totalRevenue = revenueEntries.reduce((sum, je) => sum + je.credit - je.debit, 0);

        const cogsEntries = state.journalEntries.filter(je => je.account === 'EXP-011' || je.account === 'EXP-010');
        const totalCOGS = cogsEntries.reduce((sum, je) => sum + je.debit - je.credit, 0);

        const grossProfit = totalRevenue - totalCOGS;
        const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

        const allExpenseEntries = state.journalEntries.filter(je => 
            state.expenseAccounts.some(ea => ea.id === je.account) && 
            je.account !== 'EXP-011' && je.account !== 'EXP-010' // Exclude COGS
        );
        const operatingExpenses = allExpenseEntries.reduce((sum, je) => sum + je.debit - je.credit, 0);
        
        const netIncome = grossProfit - operatingExpenses;
        const netMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;

        // Customer Acquisition (Last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const newCustomers = state.customers.filter(c => {
            // Approximation: assuming id generation correlates with time or we'd check first invoice date
            // Accurate method: Check first invoice date
            const firstInv = state.salesInvoices
                .filter(inv => inv.customerId === c.id)
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
            return firstInv && new Date(firstInv.date) >= thirtyDaysAgo;
        }).length;

        return { totalRevenue, grossProfit, grossMargin, netIncome, netMargin, newCustomers };
    }, [state.journalEntries, state.salesInvoices, state.customers, state.expenseAccounts]);

    const financialTrendData = useMemo(() => {
        const data: Record<string, { revenue: number, profit: number, margin: number }> = {};
        const now = new Date();
        
        // Initialize last 6 months
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            data[key] = { revenue: 0, profit: 0, margin: 0 };
        }

        // Process Revenue
        state.journalEntries
            .filter(je => je.account === 'REV-001')
            .forEach(je => {
                const key = je.date.substring(0, 7); // YYYY-MM
                if (data[key]) data[key].revenue += (je.credit - je.debit);
            });

        // Process All Expenses (COGS + Opex)
        state.journalEntries
            .filter(je => state.expenseAccounts.some(acc => acc.id === je.account))
            .forEach(je => {
                const key = je.date.substring(0, 7);
                if (data[key]) data[key].profit -= (je.debit - je.credit);
            });

        // Add Revenue to Profit (Profit starts at negative sum of expenses)
        Object.keys(data).forEach(key => {
            data[key].profit += data[key].revenue;
            data[key].margin = data[key].revenue > 0 ? (data[key].profit / data[key].revenue) * 100 : 0;
        });

        return Object.entries(data).map(([date, val]) => ({
            name: new Date(date + '-01').toLocaleString('default', { month: 'short' }),
            Revenue: val.revenue,
            Profit: val.profit,
            Margin: parseFloat(val.margin.toFixed(1))
        }));
    }, [state.journalEntries, state.expenseAccounts]);

    const categoryTrendsData = useMemo(() => {
        const data: Record<string, Record<string, number>> = {};
        const categories = state.categories.map(c => c.name);
        
        // Initialize months
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            data[key] = { name: new Date(key + '-01').toLocaleString('default', { month: 'short' }) } as any;
            categories.forEach(c => data[key][c] = 0);
        }

        state.salesInvoices
            .filter(inv => inv.status === InvoiceStatus.Posted)
            .forEach(inv => {
                const key = inv.date.substring(0, 7);
                if (data[key]) {
                    inv.items.forEach(item => {
                        const itemDef = state.items.find(i => i.id === item.itemId);
                        if (itemDef) {
                            const catName = state.categories.find(c => c.id === itemDef.categoryId)?.name || 'Other';
                            const val = (item.quantity * (item.rate || 0)) * (item.conversionRate || 1);
                            if (data[key][catName] !== undefined) {
                                data[key][catName] += val;
                            }
                        }
                    });
                }
            });

        return Object.values(data);
    }, [state.salesInvoices, state.items, state.categories]);

    const waterfallData = useMemo(() => {
        // Waterfall Chart Logic: Gross Revenue -> -COGS -> Gross Profit -> -Exp -> Net Income
        // We construct this using a Bar chart with transparent stack placeholders
        const rev = kpis.totalRevenue;
        const cogs = kpis.totalRevenue - kpis.grossProfit;
        const gp = kpis.grossProfit;
        const opex = gp - kpis.netIncome;
        const ni = kpis.netIncome;

        return [
            { name: 'Revenue', uv: rev, fill: '#3b82f6' }, // Blue
            { name: 'COGS', uv: -cogs, fill: '#ef4444' }, // Red
            { name: 'Gross Profit', uv: gp, fill: '#10b981' }, // Green (Result)
            { name: 'Op. Exp', uv: -opex, fill: '#f59e0b' }, // Amber
            { name: 'Net Income', uv: ni, fill: '#8b5cf6' }, // Purple (Result)
        ];
    }, [kpis]);

    const topCustomersData = useMemo(() => {
        const customerMap = new Map<string, number>();
        state.salesInvoices.filter(inv => inv.status === InvoiceStatus.Posted).forEach(inv => {
            const total = inv.items.reduce((sum, item) => sum + (item.quantity * (item.rate || 0) * (item.conversionRate || 1)), 0);
            customerMap.set(inv.customerId, (customerMap.get(inv.customerId) || 0) + total);
        });

        return Array.from(customerMap.entries())
            .map(([id, val]) => ({ 
                name: state.customers.find(c => c.id === id)?.name || id, 
                value: val 
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);
    }, [state.salesInvoices, state.customers]);

    const stockDonutData = useMemo(() => {
        const stockByCat: Record<string, number> = {};
        state.items.forEach(item => {
            const prod = state.productions.filter(p => p.itemId === item.id).reduce((s, p) => s + p.quantityProduced, 0);
            const sold = state.salesInvoices.filter(s => s.status !== InvoiceStatus.Unposted).flatMap(s => s.items).filter(i => i.itemId === item.id).reduce((s, i) => s + i.quantity, 0);
            const current = (item.openingStock || 0) + prod - sold;
            
            const weight = item.packingType !== PackingType.Kg ? (item.baleSize || 1) : 1;
            const value = current * weight * item.avgProductionPrice; // Value based
            
            const catName = state.categories.find(c => c.id === item.categoryId)?.name || 'Other';
            stockByCat[catName] = (stockByCat[catName] || 0) + value;
        });

        return Object.entries(stockByCat)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
    }, [state.items, state.productions, state.salesInvoices, state.categories]);

    const revenueTrendData = useMemo(() => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const relevantInvoices = state.salesInvoices.filter(inv =>
            inv.status === InvoiceStatus.Posted &&
            new Date(inv.date) >= thirtyDaysAgo
        );

        const grouped = relevantInvoices.reduce((acc, inv) => {
            const dateObj = new Date(inv.date);
            const key = `${dateObj.getDate()} ${dateObj.toLocaleString('default', { month: 'short' })}`;

            if (!acc[key]) {
                acc[key] = { name: key, value: 0, dateObj };
            }

            const invTotal = inv.items.reduce((sum, item) => {
                const itemDetails = state.items.find(i => i.id === item.itemId);
                let quantity = item.quantity;
                if (itemDetails?.packingType === PackingType.Bales) {
                    quantity = item.quantity * (itemDetails.baleSize || 0);
                }
                return sum + (quantity * (item.rate || 0) * (item.conversionRate || 1));
            }, 0);

            acc[key].value += invTotal + (inv.freightAmount || 0) * (inv.freightConversionRate || 1) + (inv.customCharges || 0) * (inv.customChargesConversionRate || 1);
            return acc;
        }, {} as Record<string, { name: string; value: number; dateObj: Date }>);

        return Object.values(grouped).sort((a: any, b: any) => a.dateObj.getTime() - b.dateObj.getTime());
    }, [state.salesInvoices, state.items]);

    // --- Utils ---
    const formatCurrency = (val: number) => {
        if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
        if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
        return `$${val.toFixed(0)}`;
    };

    const GRADIENTS = (
        <defs>
            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
        </defs>
    );

    const COLORS = ['#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'];

    return (
        <div className="bg-slate-900 min-h-screen p-6 text-slate-100 -m-8">
            <div className="max-w-7xl mx-auto space-y-8">
                
                {/* Header Section */}
                <div className="flex justify-between items-end border-b border-slate-800 pb-4">
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-teal-400">
                            Executive Analytics
                        </h1>
                        <p className="text-slate-400 mt-1 text-sm">Real-time financial intelligence and operational insights.</p>
                    </div>
                    <div className="text-right">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Net Income YTD</p>
                        <p className="text-2xl font-mono font-bold text-emerald-400">{formatCurrency(kpis.netIncome)}</p>
                    </div>
                </div>

                {/* Deep KPIs Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-lg relative overflow-hidden group">
                        <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Gross Revenue</p>
                        <p className="text-3xl font-bold text-white mt-2">{formatCurrency(kpis.totalRevenue)}</p>
                        <div className="mt-4 h-1 w-full bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 w-full"></div>
                        </div>
                    </div>

                    <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-lg relative overflow-hidden group">
                        <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                        </div>
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Gross Margin</p>
                        <div className="flex items-end gap-2 mt-2">
                            <p className="text-3xl font-bold text-white">{kpis.grossMargin.toFixed(1)}%</p>
                            <p className="text-sm text-emerald-400 mb-1 font-medium">{formatCurrency(kpis.grossProfit)}</p>
                        </div>
                        <div className="mt-4 h-1 w-full bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${Math.min(kpis.grossMargin, 100)}%` }}></div>
                        </div>
                    </div>

                    <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-lg relative overflow-hidden group">
                        <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                        </div>
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Net Margin</p>
                        <div className="flex items-end gap-2 mt-2">
                            <p className="text-3xl font-bold text-white">{kpis.netMargin.toFixed(1)}%</p>
                            <p className="text-sm text-purple-400 mb-1 font-medium">Actual Profit</p>
                        </div>
                        <div className="mt-4 h-1 w-full bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-500" style={{ width: `${Math.min(Math.max(kpis.netMargin, 0), 100)}%` }}></div>
                        </div>
                    </div>

                    <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-lg relative overflow-hidden group">
                        <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                        </div>
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Active Customers</p>
                        <p className="text-3xl font-bold text-white mt-2">{state.customers.filter(c => c.status !== 0).length}</p>
                        <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                            <span className="bg-amber-500/20 px-1 rounded">+{kpis.newCustomers}</span> new this month
                        </p>
                    </div>
                </div>

                {/* Main Chart Row: Financial Trends & Waterfall */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Chart 1: Revenue vs Profit (Composed) */}
                    <div className="lg:col-span-2 bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <div className="w-2 h-6 bg-blue-500 rounded-sm"></div>
                            Financial Performance Trend
                        </h3>
                        <div className="h-80 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={financialTrendData}>
                                    {GRADIENTS}
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis yAxisId="left" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatCurrency} />
                                    <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}%`} />
                                    <Tooltip content={<CustomTooltip formatter={formatCurrency} />} cursor={{ fill: '#334155', opacity: 0.2 }} />
                                    <Legend iconType="circle" wrapperStyle={{ paddingTop: '10px' }} />
                                    
                                    <Area yAxisId="left" type="monotone" dataKey="Revenue" stroke="#3b82f6" fillOpacity={1} fill="url(#colorRevenue)" strokeWidth={2} />
                                    <Bar yAxisId="left" dataKey="Profit" barSize={20} fill="#6366f1" radius={[4, 4, 0, 0]} opacity={0.8} />
                                    <Line yAxisId="right" type="monotone" dataKey="Margin" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981', strokeWidth: 0 }} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Chart 2: Profitability Waterfall */}
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <div className="w-2 h-6 bg-purple-500 rounded-sm"></div>
                            Profitability Bridge
                        </h3>
                        <div className="h-80 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={waterfallData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} interval={0} />
                                    <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `$${(Math.abs(val)/1000).toFixed(0)}k`} />
                                    <Tooltip 
                                        cursor={{fill: 'transparent'}}
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                const data = payload[0].payload;
                                                return (
                                                    <div className="bg-slate-800 border border-slate-600 p-2 rounded shadow-xl">
                                                        <p className="text-slate-200 text-xs font-bold">{data.name}</p>
                                                        <p className="text-white font-mono">{formatCurrency(Math.abs(data.uv))}</p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <ReferenceLine y={0} stroke="#475569" />
                                    <Bar dataKey="uv" radius={[4, 4, 4, 4]}>
                                        {waterfallData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.fill} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Secondary Row: Buying Trends & Customer Insights */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Chart 3: Category Buying Trends (Stacked Area) */}
                    <div className="lg:col-span-2 bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <div className="w-2 h-6 bg-pink-500 rounded-sm"></div>
                            Category Buying Trends
                        </h3>
                        <div className="h-72 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={categoryTrendsData} stackOffset="expand">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${(val * 100).toFixed(0)}%`} />
                                    <Tooltip content={<CustomTooltip formatter={formatCurrency} />} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#cbd5e1' }} />
                                    {state.categories.slice(0, 5).map((cat, index) => (
                                        <Area 
                                            key={cat.id} 
                                            type="monotone" 
                                            dataKey={cat.name} 
                                            stackId="1" 
                                            stroke={COLORS[index % COLORS.length]} 
                                            fill={COLORS[index % COLORS.length]} 
                                            fillOpacity={0.8} 
                                        />
                                    ))}
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Chart 4: Top Customers (Pareto Bar) */}
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <div className="w-2 h-6 bg-amber-500 rounded-sm"></div>
                            Top Customers (Revenue)
                        </h3>
                        <div className="h-72 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={topCustomersData} layout="vertical" margin={{ left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={true} vertical={false} />
                                    <XAxis type="number" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `$${(val/1000).toFixed(0)}k`} />
                                    <YAxis dataKey="name" type="category" stroke="#cbd5e1" fontSize={11} tickLine={false} axisLine={false} width={80} />
                                    <Tooltip content={<CustomTooltip formatter={formatCurrency} />} cursor={{fill: '#334155', opacity: 0.2}} />
                                    <Bar dataKey="value" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Third Row: Inventory Donut */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg flex flex-col">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <div className="w-2 h-6 bg-cyan-500 rounded-sm"></div>
                            Inventory Distribution (Value)
                        </h3>
                        <div className="flex-grow h-64 relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={stockDonutData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {stockDonutData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(0,0,0,0)" />
                                        ))}
                                    </Pie>
                                    <Tooltip content={<CustomTooltip formatter={formatCurrency} />} />
                                    <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#cbd5e1' }} />
                                </PieChart>
                            </ResponsiveContainer>
                            {/* Center Label for Donut */}
                            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                                <p className="text-xs text-slate-400 uppercase">Total Value</p>
                                <p className="text-lg font-bold text-white">{formatCurrency(stockDonutData.reduce((a,b)=>a+b.value,0))}</p>
                            </div>
                        </div>
                    </div>
                    
                    {/* Placeholder for future expansion or simple list */}
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <div className="w-2 h-6 bg-indigo-500 rounded-sm"></div>
                            Recent Activity Log
                        </h3>
                        <div className="space-y-3 overflow-y-auto h-64 pr-2 custom-scrollbar">
                            {state.journalEntries.slice().reverse().slice(0, 6).map(je => (
                                <div key={je.id} className="flex justify-between items-center p-3 bg-slate-700/50 rounded-lg border border-slate-700/50 hover:border-slate-600 transition-colors">
                                    <div>
                                        <p className="text-sm text-slate-200 font-medium">{je.description}</p>
                                        <p className="text-xs text-slate-500">{je.date} • {je.voucherId}</p>
                                    </div>
                                    <span className={`text-sm font-mono font-bold ${je.debit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {je.debit > 0 ? '+' : '-'}{formatCurrency(je.debit || je.credit)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Fourth Row: Sales Revenue Trend (Area Chart) */}
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <div className="w-2 h-6 bg-teal-500 rounded-sm"></div>
                        Sales Revenue Trend (Last 30 Days)
                    </h3>
                    <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={revenueTrendData}>
                                <defs>
                                    <linearGradient id="colorSalesRevenue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#1E40AF" stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor="#1E40AF" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                                <XAxis 
                                    dataKey="name" 
                                    stroke="#94a3b8" 
                                    axisLine={false} 
                                    tickLine={false} 
                                    tick={{fill: '#94a3b8', fontSize: 12}} 
                                    dy={10}
                                />
                                <YAxis 
                                    stroke="#94a3b8" 
                                    axisLine={false} 
                                    tickLine={false} 
                                    tick={{fill: '#94a3b8', fontSize: 12}} 
                                    tickFormatter={(value) => `$${value}`} 
                                    width={80}
                                />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                    itemStyle={{ color: '#e2e8f0' }}
                                    labelStyle={{ color: '#94a3b8', marginBottom: '5px' }}
                                    formatter={(value: number) => [`$${value.toLocaleString()}`, 'Revenue']}
                                />
                                <Area type="monotone" dataKey="value" stroke="#1E40AF" strokeWidth={2} fillOpacity={1} fill="url(#colorSalesRevenue)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default AnalyticsDashboard;
