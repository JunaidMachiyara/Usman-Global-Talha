# Usman Global Talha - Copilot Instructions

## Project Overview
A comprehensive React + TypeScript enterprise app for managing inventory, accounting, HR, and logistics for Usman Global Talha Division. Uses Vite for bundling, Firebase for backend, and Recharts for visualizations. Deployed to Netlify via AI Studio.

**Tech Stack:** React 19 + TypeScript + Vite + Firebase + Recharts + Tailwind CSS

## Critical Architecture

### 1. State Management (DataContext Pattern)
All data flows through **`context/DataContext.tsx`** using React's useReducer. This is the single source of truth:

- **Hook:** `const { state, dispatch, userProfile, saveStatus } = useData();`
- **Dispatch Actions:**
  - `ADD_ENTITY`: Add new item to any array (auto-increments counters like `nextInvoiceNumber`)
  - `UPDATE_ENTITY`: Modify existing item by ID
  - `DELETE_ENTITY`: Remove item by ID  
  - `BATCH_UPDATE`: Array of actions executed sequentially
  - `HARD_RESET_TRANSACTIONS`: Clear all transactional data (rare)
  - `RESTORE_STATE`: Load from Firestore (internal use)

Example patterns from codebase:
```tsx
// Adding a sales invoice
dispatch({ 
  type: 'ADD_ENTITY', 
  payload: { entity: 'salesInvoices', data: invoiceObject } 
});

// Updating an employee
dispatch({ 
  type: 'UPDATE_ENTITY', 
  payload: { entity: 'employees', data: { id: empId, advances: 500 } } 
});
```

**Critical:** All `undefined` values are converted to `null` before Firestore save (Firestore limitation).

### 2. Data Model (types.ts)
Master types defined in `types.ts`. Key entities:
- **Setup Data:** `Customer`, `Supplier`, `Item`, `Section`, `Division`, `Category`, `Bank`
- **Transactional:** `OriginalOpening`, `OriginalPurchased`, `SalesInvoice`, `Production`, `JournalEntry`
- **Special:** `JournalEntry` always stores amounts in **USD only** (foreign currency tracked in `originalAmount` field)
- **User Management:** `UserProfile` with `permissions[]` array controlling module/submodule access

### 3. Module Structure
App is organized as a plugin-style system with 12 main modules (F1-F12 keyboard shortcuts):
- **Dashboard** - Home view with KPIs
- **Setup** - CRUD for all master data (customers, items, accounts, etc.)
- **Data Entry** - Original Openings, Productions, Sales Invoices, Purchases
- **Accounting** - Journal Vouchers (Receipt, Payment, Expense, Journal types)
- **Reports** - 24+ analytical reports organized by category
- **Posting** - Convert unposted transactions to journal entries
- **Logistics** - Track container shipping and clearance
- **HR** - Attendance, salaries, tasks, enquiries
- **Admin** - User permissions, data reset
- **Chat** - Real-time Firestore messaging (with unread tracking)
- **Analytics** - High-level business metrics

Each module is a component in `components/` returning different views based on `activeSubView` prop.

### 4. Permission System
Permissions are granular strings in `UserProfile.permissions[]`:
- Main modules: `'dashboard'`, `'accounting'`, `'reports'`, etc.
- Sub-module access: `'dataEntry/opening'`, `'reports/balance-sheet'`, etc.
- Admin user gets `allPermissions` (defined in DataContext)
- Dev mode uses hardcoded mock admin (set `IS_DEV_MODE = false` in DataContext)

## Key Patterns & Conventions

### Journal Entry Creation
Automatic journal entries are created for major transactions. Pattern from `SetupModule.tsx`:
```tsx
const debitEntry: JournalEntry = {
  id: generateId(),
  voucherId: `JV-${transactionId}`,
  date: new Date().toISOString().split('T')[0],
  entryType: JournalEntryType.Journal,
  account: 'EXP-004', // Expense account
  debit: amount,
  credit: 0,
  description: 'Description here',
  entityType: 'supplier',
  entityId: supplierId,
  createdBy: userProfile?.uid,
};
dispatch({ type: 'ADD_ENTITY', payload: { entity: 'journalEntries', data: debitEntry } });
```

System accounts with fixed IDs required for automation:
- `'INV-FG-001'` - Finished Goods Inventory
- `'REV-001'` - Sales Revenue
- `'AP-001'` - Accounts Payable
- `'AR-001'` - Accounts Receivable

### Currency Handling
Multi-currency supported with USD as base:
- All `JournalEntry` debit/credit in **USD only**
- Foreign amounts stored in `originalAmount: { amount, currency }`
- Purchases tracked in foreign currency + conversion rate
- Convert using: `foreignAmount * conversionRate = USD`

### Report Architecture
Reports in `components/reports/` follow pattern:
1. Use `ReportFilters` component for date/entity selection
2. Calculate aggregate data from `state` (not real-time)
3. Render with Recharts (line, bar, pie charts)
4. Print-friendly via CSS `@media print`

Example filter props: `{ startDate, endDate, selectedCustomers, selectedSuppliers }`

### Keyboard Shortcuts
Built-in F-key navigation (App.tsx):
- F1-F12: Module navigation
- Alt+O/P/S/U: Data entry sub-views
- Escape (twice): Go back one navigation step
- Check `Modal.tsx` to prevent shortcuts in modals

### UI Components
Reusable components in `components/ui/`:
- **Modal.tsx** - Dialog wrapper (accepts `isOpen`, `onClose`, `title`, `size`)
- **CurrencyInput.tsx** - Foreign currency selector + amount input
- **EntitySelector.tsx** - Searchable dropdown for entities
- **ItemSelector.tsx** - Multi-item picker for invoices

### Development vs Production
- **Dev mode** (`IS_DEV_MODE = true`): Skips Firebase auth, uses mock admin profile
- Auto-login on localhost with hardcoded credentials
- Real-time Firestore sync still works in dev mode
- Set to `false` for production builds

## Build, Deploy & Workflows

### Build & Run
```bash
npm install              # Install deps
npm run dev             # Start Vite dev server (port 3000)
npm run build           # Build for production
```
- Requires `GEMINI_API_KEY` in `.env.local` for chatbot
- TypeScript strict mode enabled; no implicit any

### Firestore Paths
All data stored at: `appState/mainState-v11` (single document)
- Uses `onSnapshot()` for real-time updates
- Debounce saves by waiting for Firestore sync before next write
- Save status indicator: `saveStatus` ('synced' | 'saving' | 'error')

### Gemini Integration
Chatbot uses `@google/genai` API (v1.25.0):
- Proxy function at `netlify/functions/gemini-proxy.ts`
- Used in `ChatModule.tsx` for AI assistance

## Common Gotchas & Fixes

1. **Undefined vs Null**: Always convert `undefined` → `null` before Firestore
2. **Duplicate Data**: Division data has dedup logic on load (checks for ID duplicates)
3. **Unit Conversion**: Logistics receives weight in Kg, purchases in units - normalize by `packingSize`
4. **Bale Numbering**: Calculated as `openingStock + totalProduced + 1` per item
5. **Keyboard Shortcuts**: Don't fire on INPUT/TEXTAREA/SELECT elements
6. **Print Layouts**: Use `no-print` class on UI elements that shouldn't print

## File Organization
```
src/
  App.tsx                      # Main nav, keyboard shortcuts, module routing
  types.ts                     # All TypeScript interfaces (90+ types)
  context/DataContext.tsx      # Redux-like state management
  components/
    *Module.tsx                # 12 main module components
    reports/                   # 24+ analytical reports
    ui/                        # Reusable UI components
  utils/idGenerator.ts         # ID generation utilities
  netlify/functions/           # Serverless functions
```

## AI Agent Guidelines

When working on this codebase:
- Always check `types.ts` first for entity structures
- Use `useData()` hook, never direct state mutation
- Dispatch actions for any state changes (for Firestore sync)
- Test keyboard shortcuts and permission checks
- Verify foreign currency conversions to USD
- Ensure journal entries are created for transactions (if expected)
- For new modules, follow DataEntryModule pattern (form + list table + modals)
- Check `App.tsx` for keyboard shortcut conflicts when adding new ones
